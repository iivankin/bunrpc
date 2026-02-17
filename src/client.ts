import { parseErrorPayload } from "./error-payload";
import {
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
}

// ============================================================================
// RPC Error
// ============================================================================

export class RpcError<TPayload extends RpcErrorUnion = RpcErrorUnion> extends Error {
  payload: TPayload;

  constructor(payload: TPayload) {
    super(payload.message);
    this.name = "RpcError";
    this.payload = payload;
  }

  get source(): TPayload["source"] {
    return this.payload.source;
  }

  get code(): TPayload["code"] {
    return this.payload.code;
  }

  get status(): number {
    return this.payload.status;
  }

  get details(): TPayload["details"] {
    return this.payload.details;
  }
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
  const { baseUrl = "/api", fetch: customFetch = fetch, headers = {} } = config;

  async function callProcedure(
    pathParts: string[],
    input: unknown
  ): Promise<
    | { ok: true; data: unknown }
    | { ok: false; error: RpcErrorUnion }
  > {
    const path = `${baseUrl}/${pathParts.join("/")}`;

    let requestHeaders: Record<string, string>;
    try {
      requestHeaders =
        typeof headers === "function" ? await headers() : { ...headers };
    } catch (error) {
      return {
        ok: false,
        error: createSystemError("NETWORK_ERROR", 0, "Failed to resolve headers", {
          cause: String(error),
        }),
      };
    }

    const options: RequestInit = {
      method: "POST",
      headers: {
        ...requestHeaders,
        "Content-Type": "application/json",
      },
    };

    if (input !== undefined) {
      options.body = JSON.stringify(input);
    }

    let response: Response;
    try {
      response = await customFetch(path, options);
    } catch (error) {
      return {
        ok: false,
        error: createSystemError("NETWORK_ERROR", 0, "Network request failed", {
          cause: String(error),
        }),
      };
    }

    if (!response.ok) {
      const payload = await response.json().catch((): unknown => null);
      const fallback = createSystemError(
        "HTTP_ERROR",
        response.status,
        response.statusText || "Request failed"
      );

      return {
        ok: false,
        error: parseErrorPayload(payload, fallback),
      };
    }

    try {
      const data = await response.json();
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: createSystemError(
          "BAD_RESPONSE",
          response.status,
          "Invalid JSON response",
          {
            cause: String(error),
          }
        ),
      };
    }
  }

  function createProxy(pathParts: string[]): unknown {
    return new Proxy(() => {}, {
      get(_, prop: string) {
        return createProxy([...pathParts, prop]);
      },

      apply: async (_, __, args: unknown[]) => {
        const input = args[0];
        return callProcedure(pathParts, input);
      },
    });
  }

  return createProxy([]) as InferClient<TRouter>;
}
