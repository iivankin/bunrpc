import type {
  AnyProcedure,
  ProcedureAppError,
  ProcedureHttpExposed,
  ProcedureInput,
  ProcedureOutput,
} from "./procedure-types";
import type { AppRpcError, RpcResult, SystemRpcError } from "./rpc-types";

export type ClientOperationType = "mutation" | "query" | "rpc" | "subscription";

export interface ClientRequestMeta {
  operationType?: ClientOperationType;
}

export const BUNRPC_CLIENT_REQUEST_META = Symbol("bunrpc.clientRequestMeta");
export const BUNRPC_RAW_RESPONSE_HEADER = "x-bunrpc-response-mode";

export type ClientHeaders = Headers | Record<string, string>;

export interface ClientRequestOptions {
  headers?: ClientHeaders;
  signal?: AbortSignal;
  [BUNRPC_CLIENT_REQUEST_META]?: ClientRequestMeta;
}

type ProcedureServerSystemErrorsByInput<TInput> =
  | SystemRpcError<"METHOD_NOT_ALLOWED">
  | SystemRpcError<"HTTP_ERROR">
  | SystemRpcError<"INTERNAL_SERVER_ERROR">
  | (TInput extends undefined
      ? never
      : SystemRpcError<"INVALID_JSON" | "VALIDATION_ERROR">);

type ProcedureClientSystemErrors =
  | SystemRpcError<"NETWORK_ERROR">
  | SystemRpcError<"BAD_RESPONSE">;

type ProcedureSystemErrorsByInput<TInput> =
  | ProcedureServerSystemErrorsByInput<TInput>
  | ProcedureClientSystemErrors;

type ProcedureClientErrorByParts<TInput, TAppError> =
  | Extract<TAppError, AppRpcError>
  | ProcedureSystemErrorsByInput<TInput>;

type ProcedureResultByParts<TInput, TOutput, TAppError> = RpcResult<
  TOutput,
  ProcedureClientErrorByParts<TInput, TAppError>
>;

type PublicClientKey<T, TKey extends keyof T> = T[TKey] extends AnyProcedure
  ? ProcedureHttpExposed<T[TKey]> extends false
    ? never
    : TKey
  : TKey;

export type ProcedureSystemErrors<P> = ProcedureSystemErrorsByInput<
  ProcedureInput<P>
>;

export type ProcedureClientError<P> = ProcedureClientErrorByParts<
  ProcedureInput<P>,
  ProcedureAppError<P>
>;

export type ProcedureResult<P> = RpcResult<
  ProcedureOutput<P>,
  ProcedureClientError<P>
>;

export type InferClient<T> = {
  [K in keyof T as PublicClientKey<T, K>]: T[K] extends {
    _type: "procedure";
    _input: infer TInput;
    _output: infer TOutput;
    _error: infer TAppError;
  }
    ? TInput extends undefined
      ? (
          input?: undefined,
          requestOptions?: ClientRequestOptions
        ) => Promise<ProcedureResultByParts<TInput, TOutput, TAppError>>
      : (
          input: TInput,
          requestOptions?: ClientRequestOptions
        ) => Promise<ProcedureResultByParts<TInput, TOutput, TAppError>>
    : T[K] extends object
      ? InferClient<T[K]>
      : never;
};
