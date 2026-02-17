import type { InferClient, Router } from "./types";
import { parseErrorPayload } from "./error-payload";

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

export class RpcError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "RpcError";
    this.status = status;
    this.details = details;
  }
}

// ============================================================================
// Client
// ============================================================================

/**
 * Create a type-safe RPC client
 *
 * The client uses only the TYPE of the router - no runtime data is passed.
 * Paths are built from the router structure: chat.create -> POST /api/chat/create
 *
 * @example
 * ```ts
 * // Server exports type
 * export type AppRouter = typeof rpcRoutes._router;
 *
 * // Client uses only the type
 * import type { AppRouter } from "./server";
 *
 * const client = createClient<AppRouter>({ baseUrl: "/api" });
 *
 * // Full type safety
 * const chat = await client.chat.create({ title: "Hello" });
 * const user = await client.user.me();
 * ```
 */
export function createClient<TRouter extends Router>(
  config: ClientConfig = {}
): InferClient<TRouter> {
  const { baseUrl = "/api", fetch: customFetch = fetch, headers = {} } = config;

  function createProxy(pathParts: string[]): unknown {
    return new Proxy(() => {}, {
      // Property access: client.chat.create -> builds path ["chat", "create"]
      get(_, prop: string) {
        return createProxy([...pathParts, prop]);
      },

      // Function call: client.chat.create(input) -> makes request
      apply: async (_, __, args: unknown[]) => {
        const path = `${baseUrl}/${pathParts.join("/")}`;
        const input = args[0];

        // Get headers
        const requestHeaders: Record<string, string> =
          typeof headers === "function" ? await headers() : { ...headers };

        // Build request
        const options: RequestInit = {
          method: "POST",
          headers: {
            ...requestHeaders,
            "Content-Type": "application/json",
          },
        };

        // Add body if input provided
        if (input !== undefined) {
          options.body = JSON.stringify(input);
        }

        // Make request
        const response = await customFetch(path, options);

        // Handle errors
        if (!response.ok) {
          const payload = await response
            .json()
            .catch((): unknown => ({ error: response.statusText }));
          const { message, details } = parseErrorPayload(
            payload,
            "Request failed"
          );

          throw new RpcError(
            response.status,
            message,
            details
          );
        }

        return response.json();
      },
    });
  }

  return createProxy([]) as InferClient<TRouter>;
}
