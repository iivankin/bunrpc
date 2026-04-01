import type { StandardSchemaV1 } from "./standard-schema";

export type InferSchemaInput<T extends StandardSchemaV1> =
  StandardSchemaV1.InferInput<T>;

export type InferSchemaOutput<T extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<T>;

export type InferSchema<T extends StandardSchemaV1> = InferSchemaOutput<T>;

type RpcErrorSource = "app" | "system";

interface RpcErrorBase<
  TSource extends RpcErrorSource,
  TCode extends string,
  TDetails = unknown,
> {
  code: TCode;
  details?: TDetails;
  message?: string;
  source: TSource;
  status: number;
}

interface RpcErrorBaseWithMessage<
  TSource extends RpcErrorSource,
  TCode extends string,
  TDetails,
> {
  code: TCode;
  details?: TDetails;
  message: string;
  source: TSource;
  status: number;
}

interface RpcErrorBaseWithDetails<
  TSource extends RpcErrorSource,
  TCode extends string,
  TDetails,
> {
  code: TCode;
  details: TDetails;
  message: string;
  source: TSource;
  status: number;
}

export type AppRpcError<
  TCode extends string = string,
  TDetails = unknown,
> = RpcErrorBase<"app", TCode, TDetails>;

export interface ValidationIssue {
  message: string;
  path: string;
}

export interface ValidationErrorDetails {
  issues: ValidationIssue[];
}

export type SystemRpcErrorCode =
  | "METHOD_NOT_ALLOWED"
  | "INVALID_JSON"
  | "VALIDATION_ERROR"
  | "HTTP_ERROR"
  | "INTERNAL_SERVER_ERROR"
  | "NETWORK_ERROR"
  | "BAD_RESPONSE";

interface SystemErrorDetailsMap {
  BAD_RESPONSE: { cause: string };
  HTTP_ERROR: unknown;
  INTERNAL_SERVER_ERROR: unknown;
  INVALID_JSON: undefined;
  METHOD_NOT_ALLOWED: undefined;
  NETWORK_ERROR: { cause: string };
  VALIDATION_ERROR: ValidationErrorDetails;
}

export type SystemErrorDetails<TCode extends SystemRpcErrorCode> =
  SystemErrorDetailsMap[TCode];

export type SystemRpcError<
  TCode extends SystemRpcErrorCode = SystemRpcErrorCode,
> = TCode extends SystemRpcErrorCode
  ? undefined extends SystemErrorDetails<TCode>
    ? RpcErrorBaseWithMessage<
        "system",
        TCode,
        Exclude<SystemErrorDetails<TCode>, undefined>
      >
    : RpcErrorBaseWithDetails<"system", TCode, SystemErrorDetails<TCode>>
  : never;

export type RpcErrorUnion = AppRpcError | SystemRpcError;

export interface RpcResultOk<TData> {
  data: TData;
  ok: true;
}

export interface RpcResultErr<TError extends RpcErrorUnion = RpcErrorUnion> {
  error: TError;
  ok: false;
}

export type RpcResult<TData, TError extends RpcErrorUnion = RpcErrorUnion> =
  | RpcResultOk<TData>
  | RpcResultErr<TError>;

export interface AppProcedureErrorInput<
  TCode extends string = string,
  TDetails = unknown,
> {
  code: TCode;
  details?: TDetails;
  message?: string;
  status: number;
}

const PROCEDURE_ERROR_MARKER = "__bunrpcProcedureError" as const;
const NEXT_CONTEXT_MARKER = "__bunrpcNextContext" as const;

export interface ProcedureErrorResult<
  TError extends AppRpcError = AppRpcError,
> {
  readonly error: TError;
  readonly [PROCEDURE_ERROR_MARKER]: true;
}

export type ProcedureErrorFactory = <TCode extends string, TDetails = unknown>(
  input: AppProcedureErrorInput<TCode, TDetails>
) => ProcedureErrorResult<AppRpcError<TCode, TDetails>>;

export interface ProcedureHelpers {
  error: ProcedureErrorFactory;
}

export interface ProcedureNextSuccess<TData = unknown> {
  data: TData;
  ok: true;
}

export interface ProcedureNextError<TError extends AppRpcError = AppRpcError> {
  error: TError;
  ok: false;
}

export type ProcedureNextResult<
  TData = unknown,
  TError extends AppRpcError = AppRpcError,
  TContextExtension extends Record<string, unknown> = Record<string, never>,
> =
  | (ProcedureNextSuccess<TData> & {
      readonly [NEXT_CONTEXT_MARKER]?: TContextExtension;
    })
  | (ProcedureNextError<TError> & {
      readonly [NEXT_CONTEXT_MARKER]?: TContextExtension;
    });

export type ProcedureNextResultOrResponse<
  TData = unknown,
  TError extends AppRpcError = AppRpcError,
  TContextExtension extends Record<string, unknown> = Record<string, never>,
> = ProcedureNextResult<TData, TError, TContextExtension> | Response;

export type AnyProcedureNextResult = ProcedureNextResult<
  unknown,
  AppRpcError,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>;

export function createAppError<TCode extends string, TDetails = unknown>(
  input: AppProcedureErrorInput<TCode, TDetails>
): AppRpcError<TCode, TDetails> {
  const base = {
    source: "app" as const,
    code: input.code,
    status: input.status,
  };

  const withMessage =
    input.message === undefined ? base : { ...base, message: input.message };

  return input.details === undefined
    ? withMessage
    : { ...withMessage, details: input.details };
}

export function createSystemError<TCode extends SystemRpcErrorCode>(
  code: TCode,
  status: number,
  message: string,
  details?: SystemErrorDetails<TCode>
): SystemRpcError<TCode> {
  return details === undefined
    ? ({
        source: "system",
        code,
        status,
        message,
      } as SystemRpcError<TCode>)
    : ({
        source: "system",
        code,
        status,
        message,
        details,
      } as SystemRpcError<TCode>);
}

export function createProcedureErrorResult<
  TCode extends string,
  TDetails = unknown,
>(
  input: AppProcedureErrorInput<TCode, TDetails>
): ProcedureErrorResult<AppRpcError<TCode, TDetails>> {
  return {
    [PROCEDURE_ERROR_MARKER]: true,
    error: createAppError(input),
  };
}

export function isProcedureErrorResult(
  value: unknown
): value is ProcedureErrorResult<AppRpcError> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    PROCEDURE_ERROR_MARKER in value &&
    value[PROCEDURE_ERROR_MARKER as keyof typeof value] === true
  );
}

export function isAppError<TData, TError extends RpcErrorUnion>(
  result: RpcResult<TData, TError>
): result is RpcResultErr<Extract<TError, AppRpcError>> {
  return !result.ok && result.error.source === "app";
}

export function isValidationError<TData, TError extends RpcErrorUnion>(
  result: RpcResult<TData, TError>
): result is RpcResultErr<Extract<TError, SystemRpcError<"VALIDATION_ERROR">>> {
  return (
    !result.ok &&
    result.error.source === "system" &&
    result.error.code === "VALIDATION_ERROR"
  );
}

export type ProcedureErrorFromResult<TResult> =
  Extract<
    Awaited<TResult>,
    ProcedureErrorResult<AppRpcError>
  > extends infer TErrorResult
    ? TErrorResult extends ProcedureErrorResult<infer TError>
      ? TError
      : never
    : never;

export type ProcedureOutputFromResult<TResult> = Exclude<
  Awaited<TResult>,
  ProcedureErrorResult<AppRpcError>
>;

export type ProcedureResponseFromResult<TResult> = Extract<
  Awaited<TResult>,
  Response
>;

export type MiddlewareContextFromResult<TResult> =
  Awaited<TResult> extends {
    readonly [NEXT_CONTEXT_MARKER]?: infer TContext;
  }
    ? TContext extends Record<string, unknown>
      ? TContext
      : never
    : never;
