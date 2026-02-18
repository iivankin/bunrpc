import type { BunRequest, Server } from "bun";
import type { StandardSchemaV1 } from "./standard-schema";

export type { StandardSchemaV1 } from "./standard-schema";

// ============================================================================
// Standard Schema inference
// ============================================================================

export type InferSchemaInput<T extends StandardSchemaV1> =
  StandardSchemaV1.InferInput<T>;

export type InferSchemaOutput<T extends StandardSchemaV1> =
  StandardSchemaV1.InferOutput<T>;

// Backward-compatible alias
export type InferSchema<T extends StandardSchemaV1> = InferSchemaOutput<T>;

// ============================================================================
// RPC result and error types
// ============================================================================

type RpcErrorSource = "app" | "system";

interface RpcErrorBase<
  TSource extends RpcErrorSource,
  TCode extends string,
  TDetails = unknown,
> {
  source: TSource;
  code: TCode;
  status: number;
  message?: string;
  details?: TDetails;
}

interface RpcErrorBaseWithMessage<
  TSource extends RpcErrorSource,
  TCode extends string,
  TDetails,
> {
  source: TSource;
  code: TCode;
  status: number;
  message: string;
  details?: TDetails;
}

interface RpcErrorBaseWithDetails<
  TSource extends RpcErrorSource,
  TCode extends string,
  TDetails,
> {
  source: TSource;
  code: TCode;
  status: number;
  message: string;
  details: TDetails;
}

export type AppRpcError<TCode extends string = string, TDetails = unknown> =
  RpcErrorBase<"app", TCode, TDetails>;

export interface ValidationIssue {
  path: string;
  message: string;
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

type SystemErrorDetailsMap = {
  METHOD_NOT_ALLOWED: undefined;
  INVALID_JSON: undefined;
  VALIDATION_ERROR: ValidationErrorDetails;
  HTTP_ERROR: unknown;
  INTERNAL_SERVER_ERROR: unknown;
  NETWORK_ERROR: { cause: string };
  BAD_RESPONSE: { cause: string };
};

export type SystemErrorDetails<TCode extends SystemRpcErrorCode> =
  SystemErrorDetailsMap[TCode];

export type SystemRpcError<TCode extends SystemRpcErrorCode = SystemRpcErrorCode> =
  TCode extends SystemRpcErrorCode
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
  ok: true;
  data: TData;
}

export interface RpcResultErr<TError extends RpcErrorUnion = RpcErrorUnion> {
  ok: false;
  error: TError;
}

export type RpcResult<TData, TError extends RpcErrorUnion = RpcErrorUnion> =
  | RpcResultOk<TData>
  | RpcResultErr<TError>;

export interface AppProcedureErrorInput<
  TCode extends string = string,
  TDetails = unknown,
> {
  code: TCode;
  status: number;
  message?: string;
  details?: TDetails;
}

const PROCEDURE_ERROR_MARKER = "__bunrpcProcedureError" as const;

export interface ProcedureErrorResult<TError extends AppRpcError = AppRpcError> {
  readonly [PROCEDURE_ERROR_MARKER]: true;
  readonly error: TError;
}

export type ProcedureErrorFactory = <
  TCode extends string,
  TDetails = unknown,
>(
  input: AppProcedureErrorInput<TCode, TDetails>
) => ProcedureErrorResult<AppRpcError<TCode, TDetails>>;

export interface ProcedureHelpers {
  error: ProcedureErrorFactory;
}

export interface ProcedureNextSuccess<TData = unknown> {
  ok: true;
  data: TData;
}

export interface ProcedureNextError<TError extends AppRpcError = AppRpcError> {
  ok: false;
  error: TError;
}

const NEXT_CONTEXT_MARKER = "__bunrpcNextContext" as const;

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

export type AnyProcedureNextResult = ProcedureNextResult<
  unknown,
  AppRpcError,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  any
>;

export interface ProcedureMiddlewareMeta {
  path: string;
  type: "rpc";
}

export type ProcedureMiddlewareOptions<TContext> = TContext &
  BaseContext &
  ProcedureHelpers &
  ProcedureMiddlewareMeta & {
    next: <TContextExtension extends Record<string, unknown> = Record<string, never>>(
      contextExtension?: TContextExtension
    ) => Promise<ProcedureNextResult<unknown, never, TContextExtension>>;
  };

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

export type MaybePromise<T> = T | Promise<T>;

export type ProcedureErrorFromResult<TResult> = Extract<
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

export type MiddlewareContextFromResult<TResult> = Awaited<TResult> extends {
  readonly [NEXT_CONTEXT_MARKER]?: infer TContext;
}
  ? TContext extends Record<string, unknown>
    ? TContext
    : never
  : never;

// ============================================================================
// Context & Procedure types
// ============================================================================

/** Base context passed to all handlers */
export interface BaseContext {
  req: BunRequest<string>;
  server: Server<unknown>;
}

/** Procedure definition - what .handler() returns */
export interface Procedure<
  TContext = BaseContext,
  TInput = undefined,
  TOutput = unknown,
  TError extends AppRpcError = never,
> {
  _type: "procedure";
  inputSchema?: StandardSchemaV1;
  middlewares: Array<
    (
      ctx: ProcedureMiddlewareOptions<Record<string, unknown>>
    ) => MaybePromise<AnyProcedureNextResult | ProcedureErrorResult<AppRpcError>>
  >;
  handler: (
    ctx: TContext & ProcedureHelpers & { input: TInput }
  ) => Promise<TOutput | ProcedureErrorResult<TError>> | TOutput | ProcedureErrorResult<TError>;
  // Type markers for inference
  _ctx: TContext;
  _input: TInput;
  _output: TOutput;
  _error: TError;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyProcedure = Procedure<any, any, any, any>;

export type ProcedureInput<TProcedure> = TProcedure extends {
  _input: infer TInput;
}
  ? TInput
  : never;

export type ProcedureOutput<TProcedure> = TProcedure extends {
  _output: infer TOutput;
}
  ? TOutput
  : never;

export type ProcedureAppError<TProcedure> = TProcedure extends {
  _error: infer TError;
}
  ? TError extends AppRpcError
    ? TError
    : never
  : never;

// ============================================================================
// Router types
// ============================================================================

export interface Router {
  [key: string]: AnyProcedure | Router;
}

/** Routes map returned by createBunRPCRoutes */
export interface BunRPCRoutes<T extends Router> {
  _router: T;
  routes: Record<
    string,
    (req: BunRequest<string>, server: Server<unknown>) => Promise<Response>
  >;
}

// ============================================================================
// Client types - inferred from Router type only
// ============================================================================

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

type ProcedureClientErrorByParts<
  TInput,
  TAppError,
> = Extract<TAppError, AppRpcError> | ProcedureSystemErrorsByInput<TInput>;

type ProcedureResultByParts<
  TInput,
  TOutput,
  TAppError,
> = RpcResult<TOutput, ProcedureClientErrorByParts<TInput, TAppError>>;

export type ProcedureSystemErrors<P> = ProcedureSystemErrorsByInput<
  ProcedureInput<P>
>;

export type ProcedureClientError<P> = ProcedureClientErrorByParts<
  ProcedureInput<P>,
  ProcedureAppError<P>
>;

export type ProcedureResult<P> = RpcResult<ProcedureOutput<P>, ProcedureClientError<P>>;

export type InferClient<T> = {
  [K in keyof T]: T[K] extends {
    _type: "procedure";
    _input: infer TInput;
    _output: infer TOutput;
    _error: infer TAppError;
  }
    ? TInput extends undefined
      ? () => Promise<ProcedureResultByParts<TInput, TOutput, TAppError>>
      : (
          input: TInput
        ) => Promise<ProcedureResultByParts<TInput, TOutput, TAppError>>
    : T[K] extends object
      ? InferClient<T[K]>
      : never;
};
