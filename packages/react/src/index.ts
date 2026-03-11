import type {
  InfiniteData,
  QueryKey,
  UseInfiniteQueryOptions,
  UseInfiniteQueryResult,
  UseMutationOptions,
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  type ClientRequestOptions,
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

type MutationVariables<TInput> = {
  input: TInput;
  requestOptions?: ClientRequestOptions;
};

type InternalMutationResult<TInput, TOutput, TError> = UseMutationResult<
  TOutput,
  TError,
  MutationVariables<TInput>
>;

type InternalMutationCallOptions<TInput, TOutput, TError> = NonNullable<
  Parameters<InternalMutationResult<TInput, TOutput, TError>["mutate"]>[1]
>;

type PublicMutationCallOptions<TInput, TOutput, TError> = NonNullable<
  Parameters<UseMutationResult<TOutput, TError, TInput>["mutate"]>[1]
>;

type MutationCallOptions<TInput, TOutput, TError> =
  PublicMutationCallOptions<TInput, TOutput, TError> & ClientRequestOptions;

type DistributiveOmit<T, TKey extends keyof any> = T extends unknown
  ? Omit<T, TKey>
  : never;

type Override<T, TOverrides> = DistributiveOmit<T, keyof TOverrides> & TOverrides;

type MutationResult<TInput, TOutput, TError> = Override<
  InternalMutationResult<TInput, TOutput, TError>,
  {
  mutate: TInput extends undefined
    ? (
        input?: undefined,
        options?: MutationCallOptions<TInput, TOutput, TError>
      ) => void
    : (
        input: TInput,
        options?: MutationCallOptions<TInput, TOutput, TError>
      ) => void;
  mutateAsync: TInput extends undefined
    ? (
        input?: undefined,
        options?: MutationCallOptions<TInput, TOutput, TError>
      ) => Promise<TOutput>
    : (
        input: TInput,
        options?: MutationCallOptions<TInput, TOutput, TError>
      ) => Promise<TOutput>;
  variables: TInput | undefined;
}
>;

type InfiniteQueryOptions<TOutput, TError, TPageParam> = Omit<
  UseInfiniteQueryOptions<
    TOutput,
    TError,
    InfiniteData<TOutput, TPageParam>,
    QueryKey,
    TPageParam
  >,
  "queryKey" | "queryFn" | "initialPageParam" | "getNextPageParam"
> & {
  initialCursor?: TPageParam;
  getNextCursor: NonNullable<
    UseInfiniteQueryOptions<
      TOutput,
      TError,
      InfiniteData<TOutput, TPageParam>,
      QueryKey,
      TPageParam
    >["getNextPageParam"]
  >;
};

type CursorPageParam<TInput> = TInput extends { cursor?: infer TCursor }
  ? TCursor | undefined
  : never;

type InfiniteQueryHook<
  TInput,
  TOutput,
  TErrorPayload extends RpcErrorUnion,
> = TInput extends Record<string, unknown>
  ? "cursor" extends keyof TInput
    ? (
        input: Omit<TInput, "cursor">,
        options: InfiniteQueryOptions<
          TOutput,
          RpcError<TErrorPayload>,
          CursorPageParam<TInput>
        >
      ) => UseInfiniteQueryResult<
        InfiniteData<TOutput, CursorPageParam<TInput>>,
        RpcError<TErrorPayload>
      >
    : never
  : never;

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
  ) => MutationResult<TInput, TOutput, RpcError<TErrorPayload>>;

  useInfiniteQuery: InfiniteQueryHook<TInput, TOutput, TErrorPayload>;

  getQueryKey: TInput extends undefined
    ? () => QueryKey
    : (input: TInput) => QueryKey;
}

type InferQueryClient<T extends object> = {
  [K in Extract<keyof T, string>]: T[K] extends AnyProcedure
    ? QueryHooks<
        ProcedureInput<T[K]>,
        ProcedureOutput<T[K]>,
        ProcedureClientError<T[K]>
      >
    : T[K] extends object
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildInfiniteQueryInput(
  input: unknown,
  pageParam: unknown
): Record<string, unknown> {
  if (isRecord(input)) {
    return { ...input, cursor: pageParam };
  }

  throw new Error(
    "useInfiniteQuery requires object input with optional `cursor`"
  );
}

function buildMutationVariables<TInput>(
  input: TInput,
  requestOptions?: ClientRequestOptions
): MutationVariables<TInput> {
  return requestOptions === undefined ? { input } : { input, requestOptions };
}

function splitMutationCallOptions<TInput, TOutput, TError>(
  options?: MutationCallOptions<TInput, TOutput, TError>
): {
  requestOptions?: ClientRequestOptions;
  mutateOptions?: InternalMutationCallOptions<TInput, TOutput, TError>;
} {
  if (!options) {
    return {};
  }

  const { headers, signal, onSuccess, onError, onSettled, ...mutateOptions } =
    options;

  const wrappedMutateOptions: InternalMutationCallOptions<TInput, TOutput, TError> = {
    ...mutateOptions,
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
  };

  return {
    requestOptions:
      headers === undefined && signal === undefined ? undefined : { headers, signal },
    mutateOptions:
      Object.keys(wrappedMutateOptions).length === 0
        ? undefined
        : wrappedMutateOptions,
  };
}

export function createQueryClient<TRouter extends Router>(
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
    if (input === undefined) {
      return pathParts;
    }

    return [...pathParts, input];
  }

  function createProxy(pathParts: string[]): unknown {
    const hooks = {
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
          queryFn: ({ signal }) => rpcFetch(pathParts, input, { signal }),
          ...options,
        });
      },

      useMutation: (
        options?: MutationOptions<unknown, unknown, RpcError<RpcErrorUnion>>
      ) => {
        const { onMutate, onSuccess, onError, onSettled, ...mutationOptions } =
          options ?? {};

        const mutation = useMutation({
          ...mutationOptions,
          mutationFn: (variables: MutationVariables<unknown>) =>
            rpcFetch(pathParts, variables.input, variables.requestOptions),
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

        return {
          ...mutation,
          mutate: (
            input: unknown,
            mutationCallOptions?: MutationCallOptions<
              unknown,
              unknown,
              RpcError<RpcErrorUnion>
            >
          ) => {
            const { requestOptions, mutateOptions } =
              splitMutationCallOptions(mutationCallOptions);

            mutation.mutate(
              buildMutationVariables(input, requestOptions),
              mutateOptions
            );
          },
          mutateAsync: (
            input: unknown,
            mutationCallOptions?: MutationCallOptions<
              unknown,
              unknown,
              RpcError<RpcErrorUnion>
            >
          ) => {
            const { requestOptions, mutateOptions } =
              splitMutationCallOptions(mutationCallOptions);

            return mutation.mutateAsync(
              buildMutationVariables(input, requestOptions),
              mutateOptions
            );
          },
          variables: mutation.variables?.input,
        };
      },

      useInfiniteQuery: <TPageParam>(
        input: unknown,
        options: InfiniteQueryOptions<
          unknown,
          RpcError<RpcErrorUnion>,
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
              { signal }
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

        return createProxy([...pathParts, prop]);
      },
    });
  }

  return createProxy([]) as InferQueryClient<TRouter>;
}

function isQueryOptions(obj: unknown): obj is QueryOptions<unknown, RpcError> {
  if (!isRecord(obj)) return false;

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
