import {
  BUNRPC_CLIENT_REQUEST_META,
  type ClientOperationType,
  type ClientRequestOptions,
  createRpcError,
  type RpcError,
} from "@bunrpc/core";
import { createSystemError } from "@bunrpc/core/types";
import type {
  InternalMutationCallOptions,
  MutationCallOptions,
  MutationVariables,
  QueryOptions,
} from "./query-client-types";

export function createPathTraversalError(pathParts: string[]): RpcError {
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

export function buildInfiniteQueryInput(
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

export function buildMutationVariables<TInput>(
  input: TInput,
  requestOptions?: ClientRequestOptions
): MutationVariables<TInput> {
  return requestOptions === undefined ? { input } : { input, requestOptions };
}

export function splitMutationCallOptions<TInput, TOutput, TError>(
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

  const wrappedMutateOptions: InternalMutationCallOptions<
    TInput,
    TOutput,
    TError
  > = {
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
      headers === undefined && signal === undefined
        ? undefined
        : { headers, signal },
    mutateOptions:
      Object.keys(wrappedMutateOptions).length === 0
        ? undefined
        : wrappedMutateOptions,
  };
}

export function withOperationType(
  requestOptions: ClientRequestOptions | undefined,
  operationType: ClientOperationType
): ClientRequestOptions {
  return {
    ...(requestOptions ?? {}),
    [BUNRPC_CLIENT_REQUEST_META]: { operationType },
  };
}

export function isQueryOptions(
  obj: unknown
): obj is QueryOptions<unknown, RpcError> {
  if (!isRecord(obj)) {
    return false;
  }

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
