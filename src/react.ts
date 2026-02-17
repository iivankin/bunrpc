import type {
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ClientConfig } from "./client";
import { RpcError } from "./client";
import { parseErrorPayload } from "./error-payload";
import type { AnyProcedure, Router } from "./types";

// ============================================================================
// Types
// ============================================================================

/** Query options without queryKey and queryFn (we provide those) */
type QueryOptions<TOutput, TError = RpcError> = Omit<
  UseQueryOptions<TOutput, TError, TOutput, QueryKey>,
  "queryKey" | "queryFn"
>;

/** Mutation options without mutationFn (we provide that) */
type MutationOptions<TInput, TOutput, TError = RpcError> = Omit<
  UseMutationOptions<TOutput, TError, TInput>,
  "mutationFn"
>;

/** Query hooks for procedures */
interface QueryHooks<TInput, TOutput> {
  /**
   * React Query hook for fetching data
   * @example
   * const { data, isLoading } = rpc.plan.listAll.useQuery();
   * const { data } = rpc.chat.get.useQuery({ id: "123" });
   */
  useQuery: TInput extends undefined
    ? (options?: QueryOptions<TOutput>) => UseQueryResult<TOutput, RpcError>
    : (
        input: TInput,
        options?: QueryOptions<TOutput>
      ) => UseQueryResult<TOutput, RpcError>;

  /**
   * React Query hook for mutations
   * @example
   * const { mutate } = rpc.plan.remove.useMutation();
   * mutate({ id: "123" });
   */
  useMutation: (
    options?: MutationOptions<TInput, TOutput>
  ) => UseMutationResult<TOutput, RpcError, TInput>;

  /**
   * Get the query key for this procedure
   * Useful for invalidation or prefetching
   * @example
   * queryClient.invalidateQueries({ queryKey: rpc.plan.listAll.getQueryKey() });
   */
  getQueryKey: TInput extends undefined
    ? () => QueryKey
    : (input: TInput) => QueryKey;
}

/** Infer React Query client type from router */
type InferQueryClient<T extends Router> = {
  [K in keyof T]: T[K] extends AnyProcedure
    ? QueryHooks<T[K]["_input"], T[K]["_output"]>
    : T[K] extends Router
      ? InferQueryClient<T[K]>
      : never;
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Create a type-safe RPC client with React Query integration
 *
 * @example
 * ```ts
 * import type { AppRouter } from "./rpc";
 *
 * const rpc = createQueryClient<AppRouter>();
 *
 * // In components:
 * const { data, isLoading } = rpc.plan.listAll.useQuery();
 * const { data } = rpc.chat.get.useQuery({ id: "123" });
 *
 * const { mutate } = rpc.plan.remove.useMutation({
 *   onSuccess: () => rpc.plan.listAll.invalidate()
 * });
 *
 * // Manual invalidation
 * await rpc.plan.listAll.invalidate();
 * ```
 */
export function createQueryClient<TRouter extends Router>(
  config: ClientConfig = {}
): InferQueryClient<TRouter> {
  const { baseUrl = "/api", fetch: customFetch = fetch, headers = {} } = config;

  /**
   * Make an RPC request (extracted from client.ts logic)
   */
  async function rpcFetch(
    pathParts: string[],
    input: unknown
  ): Promise<unknown> {
    const path = `${baseUrl}/${pathParts.join("/")}`;

    const requestHeaders: Record<string, string> =
      typeof headers === "function" ? await headers() : { ...headers };

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

    const response = await customFetch(path, options);

    if (!response.ok) {
      const payload = await response
        .json()
        .catch((): unknown => ({ error: response.statusText }));
      const { message, details } = parseErrorPayload(payload, "Request failed");

      throw new RpcError(
        response.status,
        message,
        details
      );
    }

    return response.json();
  }

  /**
   * Build query key from path and optional input
   */
  function buildQueryKey(pathParts: string[], input?: unknown): QueryKey {
    if (input === undefined) {
      return pathParts;
    }
    return [...pathParts, input];
  }

  /**
   * Create proxy that exposes .useQuery(), .useMutation(), etc.
   */
  function createProxy(pathParts: string[]): unknown {
    // The hooks object that will be returned for procedure access
    const hooks: QueryHooks<unknown, unknown> = {
      useQuery: (
        inputOrOptions?: unknown,
        maybeOptions?: QueryOptions<unknown>
      ) => {
        // Determine if first arg is input or options
        // If maybeOptions is provided, first arg is definitely input
        // Otherwise, check if it looks like options (has enabled, staleTime, etc.)
        const hasInput =
          maybeOptions !== undefined || !isQueryOptions(inputOrOptions);
        const input = hasInput ? inputOrOptions : undefined;
        const options = hasInput
          ? maybeOptions
          : (inputOrOptions as QueryOptions<unknown>);

        return useQuery({
          queryKey: buildQueryKey(pathParts, input),
          queryFn: () => rpcFetch(pathParts, input),
          ...options,
        });
      },

      useMutation: (options?: MutationOptions<unknown, unknown>) => {
        return useMutation({
          mutationFn: (input: unknown) => rpcFetch(pathParts, input),
          ...options,
        });
      },

      getQueryKey: (input?: unknown) => buildQueryKey(pathParts, input),
    };

    return new Proxy(hooks, {
      get(target, prop: string) {
        // If accessing a hook method, return it
        if (prop in target) {
          return target[prop as keyof typeof target];
        }
        // Otherwise, continue building the path
        return createProxy([...pathParts, prop]);
      },
    });
  }

  return createProxy([]) as InferQueryClient<TRouter>;
}

/**
 * Check if an object looks like query options vs input data
 */
function isQueryOptions(obj: unknown): obj is QueryOptions<unknown> {
  if (!obj || typeof obj !== "object") return false;
  // Common query options keys
  const optionKeys = [
    "enabled",
    "staleTime",
    "gcTime",
    "refetchInterval",
    "refetchOnWindowFocus",
    "refetchOnMount",
    "refetchOnReconnect",
    "retry",
    "retryDelay",
    "select",
    "placeholderData",
    "initialData",
    "initialDataUpdatedAt",
    "networkMode",
    "meta",
    "throwOnError",
  ];
  return optionKeys.some((key) => key in obj);
}

// ============================================================================
// Utility hook for accessing query client in mutations
// ============================================================================

/**
 * Hook that provides utilities for cache invalidation
 * Use this in mutation options for type-safe invalidation
 *
 * @example
 * ```ts
 * const { invalidate } = useRpcUtils(rpc);
 *
 * const { mutate } = rpc.plan.remove.useMutation({
 *   onSuccess: () => invalidate(rpc.plan.listAll)
 * });
 * ```
 */
export function useRpcUtils<TRouter extends Router>(
  _rpc: InferQueryClient<TRouter>
) {
  const queryClient = useQueryClient();

  return {
    /**
     * Invalidate queries for a procedure
     */
    invalidate: <TInput, TOutput>(
      procedure: QueryHooks<TInput, TOutput>,
      input?: TInput
    ): Promise<void> => {
      return queryClient.invalidateQueries({
        queryKey: procedure.getQueryKey(
          input as TInput extends undefined ? never : TInput
        ),
      });
    },

    /**
     * Get the query client for advanced operations
     */
    queryClient,
  };
}
