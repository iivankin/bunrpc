import {
  type ClientConfig,
  type ClientRequestOptions,
  createClient,
  createRpcError,
  isRpcError,
} from "@bunrpc/core";
import {
  createSystemError,
  type RpcErrorUnion,
  type RpcResult,
} from "@bunrpc/core/types";
import type { QueryKey } from "@tanstack/react-query";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";
import type {
  InferQueryClient,
  InfiniteQueryOptions,
  MutationCallOptions,
  MutationOptions,
  MutationVariables,
  QueryClientRouter,
  QueryHooks,
  QueryOptions,
} from "./query-client-types";
import {
  buildInfiniteQueryInput,
  buildMutationVariables,
  createPathTraversalError,
  isQueryOptions,
  splitMutationCallOptions,
  withOperationType,
} from "./query-client-utils";

export function createQueryClient<TRouter extends QueryClientRouter>(
  config: ClientConfig = {}
): InferQueryClient<TRouter> {
  const safeClient = createClient<TRouter>(config) as Record<string, unknown>;

  function callSafeProcedure(
    pathParts: string[],
    input: unknown,
    requestOptions?: ClientRequestOptions
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

    return (
      current as (
        value: unknown,
        requestOptions?: ClientRequestOptions
      ) => Promise<RpcResult<unknown, RpcErrorUnion>>
    )(input, requestOptions);
  }

  async function rpcFetch(
    pathParts: string[],
    input: unknown,
    requestOptions?: ClientRequestOptions
  ): Promise<unknown> {
    try {
      const result = await callSafeProcedure(pathParts, input, requestOptions);

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
    return input === undefined ? pathParts : [...pathParts, input];
  }

  function createProxy(pathParts: string[]): unknown {
    const childProxies = new Map<string, unknown>();
    const hooks = {
      useQuery: (
        inputOrOptions?: unknown,
        maybeOptions?: QueryOptions<unknown, ReturnType<typeof createRpcError>>
      ) => {
        const hasInput =
          maybeOptions !== undefined || !isQueryOptions(inputOrOptions);
        const input = hasInput ? inputOrOptions : undefined;
        const options = hasInput
          ? maybeOptions
          : (inputOrOptions as QueryOptions<
              unknown,
              ReturnType<typeof createRpcError>
            >);

        return useQuery({
          queryKey: buildQueryKey(pathParts, input),
          queryFn: ({ signal }) =>
            rpcFetch(pathParts, input, withOperationType({ signal }, "query")),
          ...options,
        });
      },

      useMutation: (
        options?: MutationOptions<
          unknown,
          unknown,
          ReturnType<typeof createRpcError>
        >
      ) => {
        const { onMutate, onSuccess, onError, onSettled, ...mutationOptions } =
          options ?? {};

        const mutation = useMutation({
          ...mutationOptions,
          mutationFn: (variables: MutationVariables<unknown>) =>
            rpcFetch(
              pathParts,
              variables.input,
              withOperationType(variables.requestOptions, "mutation")
            ),
          onMutate: onMutate
            ? (variables: MutationVariables<unknown>, context) =>
                onMutate(variables.input, context)
            : undefined,
          onSuccess: onSuccess
            ? (data, variables, onMutateResult, context) =>
                onSuccess(data, variables.input, onMutateResult, context)
            : undefined,
          onError: onError
            ? (error, variables, onMutateResult, context) =>
                onError(error, variables.input, onMutateResult, context)
            : undefined,
          onSettled: onSettled
            ? (data, error, variables, onMutateResult, context) =>
                onSettled(data, error, variables.input, onMutateResult, context)
            : undefined,
        });

        const mutate = useCallback(
          (
            input: unknown,
            mutationCallOptions?: MutationCallOptions<
              unknown,
              unknown,
              ReturnType<typeof createRpcError>
            >
          ) => {
            const { requestOptions, mutateOptions } =
              splitMutationCallOptions(mutationCallOptions);

            mutation.mutate(
              buildMutationVariables(input, requestOptions),
              mutateOptions
            );
          },
          [mutation.mutate]
        );
        const mutateAsync = useCallback(
          (
            input: unknown,
            mutationCallOptions?: MutationCallOptions<
              unknown,
              unknown,
              ReturnType<typeof createRpcError>
            >
          ) => {
            const { requestOptions, mutateOptions } =
              splitMutationCallOptions(mutationCallOptions);

            return mutation.mutateAsync(
              buildMutationVariables(input, requestOptions),
              mutateOptions
            );
          },
          [mutation.mutateAsync]
        );

        return {
          ...mutation,
          mutate,
          mutateAsync,
          variables: mutation.variables?.input,
        };
      },

      useInfiniteQuery: <TPageParam>(
        input: unknown,
        options: InfiniteQueryOptions<
          unknown,
          ReturnType<typeof createRpcError>,
          TPageParam
        >
      ) => {
        const { initialCursor, getNextCursor, ...queryOptions } = options;

        return useInfiniteQuery({
          queryKey: buildQueryKey(pathParts, input),
          queryFn: ({ pageParam, signal }) =>
            rpcFetch(
              pathParts,
              buildInfiniteQueryInput(input, pageParam as TPageParam),
              withOperationType({ signal }, "query")
            ),
          initialPageParam: initialCursor as TPageParam,
          getNextPageParam: getNextCursor,
          ...queryOptions,
        });
      },

      getQueryKey: (input?: unknown) => buildQueryKey(pathParts, input),
    };

    return new Proxy(hooks, {
      get(target, prop: string) {
        if (prop in target) {
          return target[prop as keyof typeof target];
        }

        const cached = childProxies.get(prop);
        if (cached) {
          return cached;
        }

        const child = createProxy([...pathParts, prop]);
        childProxies.set(prop, child);
        return child;
      },
    });
  }

  return createProxy([]) as InferQueryClient<TRouter>;
}

export function useRpcUtils<TRouter extends object>(
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
