import type {
  QueryKey,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createClient,
  createRpcError,
  isRpcError,
  type ClientConfig,
  type RpcError,
} from "@bunrpc/core";
import {
  createSystemError,
  type AnyProcedure,
  type ProcedureClientError,
  type ProcedureInput,
  type ProcedureOutput,
  type Router,
  type RpcErrorUnion,
  type RpcResult,
} from "@bunrpc/core/types";

// ============================================================================
// Types
// ============================================================================

type QueryOptions<TOutput, TError> = Omit<
  UseQueryOptions<TOutput, TError, TOutput, QueryKey>,
  "queryKey" | "queryFn"
>;

type MutationOptions<TInput, TOutput, TError> = Omit<
  UseMutationOptions<TOutput, TError, TInput>,
  "mutationFn"
>;

interface QueryHooks<
  TInput,
  TOutput,
  TErrorPayload extends RpcErrorUnion,
> {
  useQuery: TInput extends undefined
    ? (
        options?: QueryOptions<TOutput, RpcError<TErrorPayload>>
      ) => UseQueryResult<TOutput, RpcError<TErrorPayload>>
    : (
        input: TInput,
        options?: QueryOptions<TOutput, RpcError<TErrorPayload>>
      ) => UseQueryResult<TOutput, RpcError<TErrorPayload>>;

  useMutation: (
    options?: MutationOptions<TInput, TOutput, RpcError<TErrorPayload>>
  ) => UseMutationResult<TOutput, RpcError<TErrorPayload>, TInput>;

  getQueryKey: TInput extends undefined
    ? () => QueryKey
    : (input: TInput) => QueryKey;
}

type InferQueryClient<T extends Router> = {
  [K in keyof T]: T[K] extends AnyProcedure
    ? QueryHooks<
        ProcedureInput<T[K]>,
        ProcedureOutput<T[K]>,
        ProcedureClientError<T[K]>
      >
    : T[K] extends Router
      ? InferQueryClient<T[K]>
      : never;
};

// ============================================================================
// Implementation
// ============================================================================

function createPathTraversalError(pathParts: string[]): RpcError {
  return createRpcError(
    createSystemError(
      "BAD_RESPONSE",
      500,
      `Invalid procedure path: ${pathParts.join(".") || "(root)"}`
    )
  );
}

export function createQueryClient<TRouter extends Router>(
  config: ClientConfig = {}
): InferQueryClient<TRouter> {
  const safeClient = createClient<TRouter>(config) as Record<string, unknown>;

  function callSafeProcedure(
    pathParts: string[],
    input: unknown
  ): Promise<RpcResult<unknown, RpcErrorUnion>> {
    let current: unknown = safeClient;

    for (const part of pathParts) {
      if (
        (typeof current !== "object" || current === null) &&
        typeof current !== "function"
      ) {
        throw createPathTraversalError(pathParts);
      }

      current = (current as Record<string, unknown>)[part];
    }

    if (typeof current !== "function") {
      throw createPathTraversalError(pathParts);
    }

    return (current as (value: unknown) => Promise<RpcResult<unknown, RpcErrorUnion>>)(
      input
    );
  }

  async function rpcFetch(pathParts: string[], input: unknown): Promise<unknown> {
    try {
      const result = await callSafeProcedure(pathParts, input);

      if (!result.ok) {
        throw createRpcError(result.error);
      }

      return result.data;
    } catch (error) {
      if (isRpcError(error)) {
        throw error;
      }

      throw createRpcError(
        createSystemError("BAD_RESPONSE", 500, "Failed to execute procedure", {
          cause: String(error),
        })
      );
    }
  }

  function buildQueryKey(pathParts: string[], input?: unknown): QueryKey {
    if (input === undefined) {
      return pathParts;
    }

    return [...pathParts, input];
  }

  function createProxy(pathParts: string[]): unknown {
    const hooks: QueryHooks<unknown, unknown, RpcErrorUnion> = {
      useQuery: (
        inputOrOptions?: unknown,
        maybeOptions?: QueryOptions<unknown, RpcError<RpcErrorUnion>>
      ) => {
        const hasInput =
          maybeOptions !== undefined || !isQueryOptions(inputOrOptions);
        const input = hasInput ? inputOrOptions : undefined;
        const options = hasInput
          ? maybeOptions
          : (inputOrOptions as QueryOptions<unknown, RpcError<RpcErrorUnion>>);

        return useQuery({
          queryKey: buildQueryKey(pathParts, input),
          queryFn: () => rpcFetch(pathParts, input),
          ...options,
        });
      },

      useMutation: (
        options?: MutationOptions<unknown, unknown, RpcError<RpcErrorUnion>>
      ) => {
        return useMutation({
          mutationFn: (input: unknown) => rpcFetch(pathParts, input),
          ...options,
        });
      },

      getQueryKey: (input?: unknown) => buildQueryKey(pathParts, input),
    };

    return new Proxy(hooks, {
      get(target, prop: string) {
        if (prop in target) {
          return target[prop as keyof typeof target];
        }

        return createProxy([...pathParts, prop]);
      },
    });
  }

  return createProxy([]) as InferQueryClient<TRouter>;
}

function isQueryOptions(obj: unknown): obj is QueryOptions<unknown, RpcError> {
  if (!obj || typeof obj !== "object") return false;

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

export function useRpcUtils<TRouter extends Router>(
  _rpc: InferQueryClient<TRouter>
) {
  const queryClient = useQueryClient();

  return {
    invalidate: <TInput, TOutput, TErrorPayload extends RpcErrorUnion>(
      procedure: QueryHooks<TInput, TOutput, TErrorPayload>,
      input?: TInput
    ): Promise<void> => {
      return queryClient.invalidateQueries({
        queryKey: procedure.getQueryKey(
          input as TInput extends undefined ? never : TInput
        ),
      });
    },
    queryClient,
  };
}
