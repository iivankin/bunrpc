import type { ClientRequestOptions, RpcError } from "@bunrpc/core";
import type {
  AnyProcedure,
  ProcedureClientError,
  ProcedureHttpExposed,
  ProcedureInput,
  ProcedureOutput,
  Router,
  RpcErrorUnion,
} from "@bunrpc/core/types";
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

export type QueryOptions<TOutput, TError> = Omit<
  UseQueryOptions<TOutput, TError, TOutput, QueryKey>,
  "queryKey" | "queryFn"
>;

export type MutationOptions<TInput, TOutput, TError> = Omit<
  UseMutationOptions<TOutput, TError, TInput>,
  "mutationFn"
>;

export interface MutationVariables<TInput> {
  input: TInput;
  requestOptions?: ClientRequestOptions;
}

type InternalMutationResult<TInput, TOutput, TError> = UseMutationResult<
  TOutput,
  TError,
  MutationVariables<TInput>
>;

export type InternalMutationCallOptions<TInput, TOutput, TError> = NonNullable<
  Parameters<InternalMutationResult<TInput, TOutput, TError>["mutate"]>[1]
>;

type PublicMutationCallOptions<TInput, TOutput, TError> = NonNullable<
  Parameters<UseMutationResult<TOutput, TError, TInput>["mutate"]>[1]
>;

export type MutationCallOptions<TInput, TOutput, TError> =
  PublicMutationCallOptions<TInput, TOutput, TError> & ClientRequestOptions;

type DistributiveOmit<T, TKey extends keyof any> = T extends unknown
  ? Omit<T, TKey>
  : never;

type Override<T, TOverrides> = DistributiveOmit<T, keyof TOverrides> &
  TOverrides;

export type MutationResult<TInput, TOutput, TError> = Override<
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

export type InfiniteQueryOptions<TOutput, TError, TPageParam> = Omit<
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

type InfiniteQueryHook<TInput, TOutput, TErrorPayload extends RpcErrorUnion> =
  TInput extends Record<string, unknown>
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

export interface QueryHooks<
  TInput,
  TOutput,
  TErrorPayload extends RpcErrorUnion,
> {
  getQueryKey: TInput extends undefined
    ? () => QueryKey
    : (input: TInput) => QueryKey;
  useInfiniteQuery: InfiniteQueryHook<TInput, TOutput, TErrorPayload>;
  useMutation: (
    options?: MutationOptions<TInput, TOutput, RpcError<TErrorPayload>>
  ) => MutationResult<TInput, TOutput, RpcError<TErrorPayload>>;
  useQuery: TInput extends undefined
    ? (
        options?: QueryOptions<TOutput, RpcError<TErrorPayload>>
      ) => UseQueryResult<TOutput, RpcError<TErrorPayload>>
    : (
        input: TInput,
        options?: QueryOptions<TOutput, RpcError<TErrorPayload>>
      ) => UseQueryResult<TOutput, RpcError<TErrorPayload>>;
}

export type InferQueryClient<T extends object> = {
  [K in keyof T as T[K] extends AnyProcedure
    ? ProcedureHttpExposed<T[K]> extends false
      ? never
      : K
    : K]: T[K] extends AnyProcedure
    ? QueryHooks<
        ProcedureInput<T[K]>,
        ProcedureOutput<T[K]>,
        ProcedureClientError<T[K]>
      >
    : T[K] extends object
      ? InferQueryClient<T[K]>
      : never;
};

export type QueryClientRouter = Router;
