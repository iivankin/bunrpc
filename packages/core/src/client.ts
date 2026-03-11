import { parseErrorPayload } from "./error-payload";
import {
  type ClientRequestOptions,
  createSystemError,
  type InferClient,
  type Router,
  type RpcErrorUnion,
} from "./types";

// ============================================================================
// Client Configuration
// ============================================================================

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface ClientConfig {
  /** Base URL for API requests (default: "/api") */
  baseUrl?: string;
  /** Custom fetch function */
  fetch?: FetchFn;
  /** Pretty request/response console logging (default: true outside production) */
  log?: boolean;
  /** Headers to include in all requests */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
}

// ============================================================================
// RPC Error
// ============================================================================

const RPC_ERROR_MARKER = "__bunrpcRpcError" as const;

type RpcErrorShape<TPayload extends RpcErrorUnion> = {
  readonly [RPC_ERROR_MARKER]: true;
  source: TPayload["source"];
  code: TPayload["code"];
  status: number;
  details: TPayload["details"];
};

export type RpcError<TPayload extends RpcErrorUnion = RpcErrorUnion> =
  TPayload extends RpcErrorUnion ? Error & RpcErrorShape<TPayload> : never;

export function createRpcError<TPayload extends RpcErrorUnion>(
  payload: TPayload
): RpcError<TPayload> {
  const error = new Error(payload.message ?? payload.code) as RpcError<TPayload>;
  error.name = "RpcError";

  const target = error as unknown as Record<string, unknown>;
  target[RPC_ERROR_MARKER] = true;
  target.source = payload.source;
  target.code = payload.code;
  target.status = payload.status;
  target.details = payload.details;

  return error;
}

export function isRpcError(error: unknown): error is RpcError {
  if (!(error instanceof Error)) {
    return false;
  }

  const value = error as unknown as Record<string, unknown>;
  return value[RPC_ERROR_MARKER] === true;
}

// ============================================================================
// Client Logging
// ============================================================================

type ClientCallResult =
  | { ok: true; data: unknown }
  | { ok: false; error: RpcErrorUnion };

interface ClientLogEvent {
  durationMs?: number;
  input: unknown;
  result?: ClientCallResult;
  url: string;
  procedurePath: string;
}

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  cyan: "\u001B[36m",
  blue: "\u001B[34m",
  green: "\u001B[32m",
  red: "\u001B[31m",
} as const;

function getNodeEnv(): string | undefined {
  return (
    globalThis as typeof globalThis & {
      process?: {
        env?: {
          NODE_ENV?: string;
        };
      };
    }
  ).process?.env?.NODE_ENV;
}

function resolveClientLogging(log: boolean | undefined): boolean {
  return log ?? getNodeEnv() !== "production";
}

function isBrowserConsole(): boolean {
  const globalScope = globalThis as typeof globalThis & {
    document?: object;
    window?: object;
  };

  return globalScope.window !== undefined && globalScope.document !== undefined;
}

function openLogGroup(message: string, ...args: unknown[]): void {
  if (typeof console.groupCollapsed === "function") {
    console.groupCollapsed(message, ...args);
    return;
  }

  console.log(message, ...args);
}

function closeLogGroup(): void {
  if (typeof console.groupEnd === "function") {
    console.groupEnd();
  }
}

function logPayload(label: string, value: unknown): void {
  if (isBrowserConsole()) {
    console.log("%c%s", "color:#64748b;font-weight:700;", label, value);
    return;
  }

  console.log(label, value);
}

function formatDuration(durationMs: number): string {
  return `${durationMs.toFixed(durationMs >= 100 ? 0 : 1)}ms`;
}

function logClientRequest(event: ClientLogEvent): void {
  if (isBrowserConsole()) {
    openLogGroup(
      "%c bunrpc %c request %c %s %c POST %s",
      "background:#111827;color:#f8fafc;border-radius:999px;padding:2px 8px;font-weight:700;",
      "color:#2563eb;font-weight:700;",
      "color:#0f172a;font-weight:700;",
      event.procedurePath,
      "color:#64748b;",
      event.url
    );
    logPayload("input", event.input);
    closeLogGroup();
    return;
  }

  openLogGroup(
    `${ANSI.cyan}${ANSI.bold}[bunrpc]${ANSI.reset} ${ANSI.blue}request${ANSI.reset} ${ANSI.bold}${event.procedurePath}${ANSI.reset} ${ANSI.dim}POST ${event.url}${ANSI.reset}`
  );
  logPayload("input", event.input);
  closeLogGroup();
}

function logClientResponse(event: ClientLogEvent): void {
  if (event.result === undefined || event.durationMs === undefined) {
    return;
  }

  const statusLabel = event.result.ok
    ? "OK"
    : `${event.result.error.source}:${event.result.error.code}`;
  const payloadLabel = event.result.ok ? "response" : "error";

  if (isBrowserConsole()) {
    openLogGroup(
      "%c bunrpc %c response %c %s %c %s %c %s",
      "background:#111827;color:#f8fafc;border-radius:999px;padding:2px 8px;font-weight:700;",
      `color:${event.result.ok ? "#16a34a" : "#dc2626"};font-weight:700;`,
      "color:#0f172a;font-weight:700;",
      event.procedurePath,
      "color:#64748b;",
      formatDuration(event.durationMs),
      `color:${event.result.ok ? "#16a34a" : "#dc2626"};font-weight:700;`,
      statusLabel
    );
    logPayload("input", event.input);
    logPayload(payloadLabel, event.result.ok ? event.result.data : event.result.error);
    closeLogGroup();
    return;
  }

  openLogGroup(
    `${ANSI.cyan}${ANSI.bold}[bunrpc]${ANSI.reset} ${
      event.result.ok ? ANSI.green : ANSI.red
    }response${ANSI.reset} ${ANSI.bold}${event.procedurePath}${ANSI.reset} ${ANSI.dim}${formatDuration(
      event.durationMs
    )}${ANSI.reset} ${
      event.result.ok ? ANSI.green : ANSI.red
    }${statusLabel}${ANSI.reset}`
  );
  logPayload("input", event.input);
  logPayload(payloadLabel, event.result.ok ? event.result.data : event.result.error);
  closeLogGroup();
}

// ============================================================================
// Client
// ============================================================================

/**
 * Create a type-safe safe-result RPC client.
 *
 * All procedure calls return a discriminated union:
 * - `{ ok: true, data }` on success
 * - `{ ok: false, error }` on failure
 */
export function createClient<TRouter extends Router>(
  config: ClientConfig = {}
): InferClient<TRouter> {
  const {
    baseUrl = "/api",
    fetch: customFetch = fetch,
    headers = {},
    log,
  } = config;
  const shouldLog = resolveClientLogging(log);

  async function callProcedure(
    pathParts: string[],
    input: unknown,
    requestOptions?: ClientRequestOptions
  ): Promise<ClientCallResult> {
    const path = `${baseUrl}/${pathParts.join("/")}`;
    const procedurePath = pathParts.join(".");
    const startedAt = Date.now();

    if (shouldLog) {
      logClientRequest({
        input,
        procedurePath,
        url: path,
      });
    }

    const finalize = (result: ClientCallResult): ClientCallResult => {
      if (shouldLog) {
        logClientResponse({
          durationMs: Date.now() - startedAt,
          input,
          procedurePath,
          result,
          url: path,
        });
      }

      return result;
    };

    let requestHeaders: Record<string, string>;
    try {
      requestHeaders =
        typeof headers === "function" ? await headers() : { ...headers };
    } catch (error) {
      return finalize({
        ok: false,
        error: createSystemError("NETWORK_ERROR", 0, "Failed to resolve headers", {
          cause: String(error),
        }),
      });
    }

    const options: RequestInit = {
      method: "POST",
      headers: {
        ...requestHeaders,
        ...requestOptions?.headers,
        "Content-Type": "application/json",
      },
      signal: requestOptions?.signal,
    };

    if (input !== undefined) {
      options.body = JSON.stringify(input);
    }

    let response: Response;
    try {
      response = await customFetch(path, options);
    } catch (error) {
      return finalize({
        ok: false,
        error: createSystemError("NETWORK_ERROR", 0, "Network request failed", {
          cause: String(error),
        }),
      });
    }

    if (!response.ok) {
      const payload = await response.json().catch((): unknown => null);
      const fallback = createSystemError(
        "HTTP_ERROR",
        response.status,
        response.statusText || "Request failed"
      );

      return finalize({
        ok: false,
        error: parseErrorPayload(payload, fallback),
      });
    }

    try {
      const data = await response.json();
      return finalize({ ok: true, data });
    } catch (error) {
      return finalize({
        ok: false,
        error: createSystemError(
          "BAD_RESPONSE",
          response.status,
          "Invalid JSON response",
          {
            cause: String(error),
          }
        ),
      });
    }
  }

  function createProxy(pathParts: string[]): unknown {
    return new Proxy(() => {}, {
      get(_, prop: string) {
        return createProxy([...pathParts, prop]);
      },

      apply: async (_, __, args: unknown[]) => {
        const input = args[0];
        const requestOptions = args[1] as ClientRequestOptions | undefined;
        return callProcedure(pathParts, input, requestOptions);
      },
    });
  }

  return createProxy([]) as InferClient<TRouter>;
}
