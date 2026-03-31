import { parseErrorPayload } from "./error-payload";
import {
  BUNRPC_CLIENT_REQUEST_META,
  BUNRPC_RAW_RESPONSE_HEADER,
  type ClientOperationType,
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
  /** Headers to include in all requests */
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>);
  /** Pretty request/response console logging (default: true outside production) */
  log?: boolean;
}

// ============================================================================
// RPC Error
// ============================================================================

const RPC_ERROR_MARKER = "__bunrpcRpcError" as const;

interface RpcErrorShape<TPayload extends RpcErrorUnion> {
  code: TPayload["code"];
  details: TPayload["details"];
  source: TPayload["source"];
  status: number;
  readonly [RPC_ERROR_MARKER]: true;
}

export type RpcError<TPayload extends RpcErrorUnion = RpcErrorUnion> =
  TPayload extends RpcErrorUnion ? Error & RpcErrorShape<TPayload> : never;

export function createRpcError<TPayload extends RpcErrorUnion>(
  payload: TPayload
): RpcError<TPayload> {
  const error = new Error(
    payload.message ?? payload.code
  ) as RpcError<TPayload>;
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
  callId: number;
  customHeaders?: Record<string, string>;
  durationMs?: number;
  input: unknown;
  operationType: ClientOperationType;
  procedurePath: string;
  result?: ClientCallResult;
  url: string;
}

const ANSI = {
  reset: "\u001B[0m",
  bold: "\u001B[1m",
  dim: "\u001B[2m",
  cyan: "\u001B[36m",
  blue: "\u001B[34m",
  green: "\u001B[32m",
  magenta: "\u001B[35m",
  red: "\u001B[31m",
  yellow: "\u001B[33m",
} as const;

function isBrowserConsole(): boolean {
  const globalScope = globalThis as typeof globalThis & {
    document?: object;
    window?: object;
  };

  return globalScope.window !== undefined && globalScope.document !== undefined;
}

function formatDuration(durationMs: number): number {
  return durationMs >= 100
    ? Math.round(durationMs)
    : Number(durationMs.toFixed(1));
}

function getOperationBrowserStyle(operationType: ClientOperationType): string {
  switch (operationType) {
    case "mutation":
      return "background:#fde047;color:#713f12;border-radius:4px;padding:2px 8px;font-weight:700;";
    case "query":
      return "background:#67e8f9;color:#164e63;border-radius:4px;padding:2px 8px;font-weight:700;";
    case "subscription":
      return "background:#c4b5fd;color:#5b21b6;border-radius:4px;padding:2px 8px;font-weight:700;";
    case "rpc":
      return "background:#d1d5db;color:#111827;border-radius:4px;padding:2px 8px;font-weight:700;";
    default:
      return "background:#d1d5db;color:#111827;border-radius:4px;padding:2px 8px;font-weight:700;";
  }
}

function getOperationTerminalColor(operationType: ClientOperationType): string {
  switch (operationType) {
    case "mutation":
      return ANSI.yellow;
    case "query":
      return ANSI.cyan;
    case "subscription":
      return ANSI.magenta;
    case "rpc":
      return ANSI.blue;
    default:
      return ANSI.blue;
  }
}

function buildLogLabel(
  event: ClientLogEvent,
  direction: "request" | "response"
): string {
  const arrow = direction === "request" ? ">>" : "<<";
  return `${arrow} ${event.operationType} #${event.callId} ${event.procedurePath}`;
}

function buildRequestPayload(event: ClientLogEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (event.customHeaders !== undefined) {
    payload.headers = event.customHeaders;
  }

  if (event.input !== undefined) {
    payload.input = event.input;
  }

  return payload;
}

function buildResponsePayload(event: ClientLogEvent): Record<string, unknown> {
  if (event.result === undefined || event.durationMs === undefined) {
    return {};
  }

  const payload = buildRequestPayload(event);

  payload.elapsedMs = formatDuration(event.durationMs);
  payload[event.result.ok ? "result" : "error"] = event.result.ok
    ? event.result.data
    : event.result.error;

  return payload;
}

function logClientEvent(
  event: ClientLogEvent,
  direction: "request" | "response"
): void {
  const label = buildLogLabel(event, direction);
  const payload =
    direction === "request"
      ? buildRequestPayload(event)
      : buildResponsePayload(event);
  const consoleMethod =
    direction === "response" && event.result && !event.result.ok
      ? console.error
      : console.log;

  if (isBrowserConsole()) {
    consoleMethod.call(
      console,
      "%c%s",
      getOperationBrowserStyle(event.operationType),
      label,
      payload
    );
    return;
  }

  consoleMethod.call(
    console,
    `${getOperationTerminalColor(event.operationType)}${ANSI.bold}${label}${ANSI.reset}`,
    payload
  );
}

function logClientRequest(event: ClientLogEvent): void {
  logClientEvent(event, "request");
}

function logClientResponse(event: ClientLogEvent): void {
  if (event.result === undefined || event.durationMs === undefined) {
    return;
  }

  logClientEvent(event, "response");
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
  const shouldLog = log ?? process.env.NODE_ENV !== "production";
  let nextCallId = 1;

  async function callProcedure(
    pathParts: string[],
    input: unknown,
    requestOptions?: ClientRequestOptions
  ): Promise<ClientCallResult> {
    const path = `${baseUrl}/${pathParts.join("/")}`;
    const callId = nextCallId++;
    const operationType =
      requestOptions?.[BUNRPC_CLIENT_REQUEST_META]?.operationType ?? "rpc";
    const procedurePath = pathParts.join(".");
    const startedAt = Date.now();
    let loggedCustomHeaders: Record<string, string> | undefined;

    const finalize = (result: ClientCallResult): ClientCallResult => {
      if (shouldLog) {
        logClientResponse({
          callId,
          customHeaders: loggedCustomHeaders,
          durationMs: Date.now() - startedAt,
          input,
          operationType,
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
        error: createSystemError(
          "NETWORK_ERROR",
          0,
          "Failed to resolve headers",
          {
            cause: String(error),
          }
        ),
      });
    }

    const customHeaders = {
      ...requestHeaders,
      ...requestOptions?.headers,
    };
    loggedCustomHeaders =
      Object.keys(customHeaders).length === 0 ? undefined : customHeaders;

    if (shouldLog) {
      logClientRequest({
        callId,
        customHeaders: loggedCustomHeaders,
        input,
        operationType,
        procedurePath,
        url: path,
      });
    }

    const options: RequestInit = {
      method: "POST",
      headers: {
        ...customHeaders,
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

    if (response.headers.get(BUNRPC_RAW_RESPONSE_HEADER) === "raw") {
      return finalize({ ok: true, data: response });
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

      apply: (_, __, args: unknown[]) => {
        const input = args[0];
        const requestOptions = args[1] as ClientRequestOptions | undefined;
        return callProcedure(pathParts, input, requestOptions);
      },
    });
  }

  return createProxy([]) as InferClient<TRouter>;
}
