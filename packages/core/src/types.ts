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

export interface ProcedureMiddlewareMeta {
  path: string;
  type: "rpc";
}

export type ProcedureMiddlewareOptions<
  TContext,
  TBaseContext extends BaseContext = BaseContext,
> = TContext &
  TBaseContext &
  ProcedureHelpers &
  ProcedureMiddlewareMeta & {
    next: <
      TContextExtension extends Record<string, unknown> = Record<string, never>,
    >(
      contextExtension?: TContextExtension
    ) => Promise<
      ProcedureNextResultOrResponse<unknown, never, TContextExtension>
    >;
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

export type UnionToIntersection<T> = (
  T extends unknown
    ? (value: T) => void
    : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

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

// ============================================================================
// Context & Procedure types
// ============================================================================

/**
 * Metadata patch used by plugin-defined terminal handler methods.
 *
 * Set `__httpExposed: false` for procedures that should be hidden from the
 * normal HTTP/client surface while still remaining visible to plugin setup.
 */
export type PluginHandlerMethodPatch<
  TMeta extends object = Record<string, never>,
  THttpExposed extends boolean = true,
> = TMeta & {
  __httpExposed?: THttpExposed;
};

/** Base context passed to all handlers */
export interface BaseContext {
  req: BunRequest<string>;
  requestSource: string;
  server: Server<unknown>;
}

/** Procedure definition - what .handler() returns */
export interface Procedure<
  TContext = BaseContext,
  TInput = undefined,
  TOutput = unknown,
  TError extends AppRpcError = never,
  THttpExposed extends boolean = true,
> {
  // Type markers for inference
  _ctx: TContext;
  _error: TError;
  _httpExposed: THttpExposed;
  _input: TInput;
  _output: TOutput;
  _type: "procedure";
  handler: (
    ctx: TContext & ProcedureHelpers & { input: TInput }
  ) =>
    | Promise<TOutput | ProcedureErrorResult<TError>>
    | TOutput
    | ProcedureErrorResult<TError>
    | Response;
  inputSchema?: StandardSchemaV1;
  middlewares: Array<
    (
      ctx: ProcedureMiddlewareOptions<Record<string, unknown>>
    ) => MaybePromise<
      AnyProcedureNextResult | ProcedureErrorResult<AppRpcError> | Response
    >
  >;
  outputSchema?: StandardSchemaV1;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyProcedure = Procedure<any, any, any, any, boolean>;

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

export type ProcedureHttpExposed<TProcedure> = TProcedure extends {
  _httpExposed: infer THttpExposed;
}
  ? THttpExposed extends boolean
    ? THttpExposed
    : true
  : true;

// ============================================================================
// Plugin types
// ============================================================================

export type BunRPCRouteHandler = (
  req: BunRequest<string>,
  server: Server<unknown>
) => Promise<Response> | Response;

/**
 * A regular procedure builder method like `.summary(...)` or `.tool(...)`.
 * It returns a metadata patch that bunrpc stores on the procedure.
 */
export type BunRPCPluginMethod = (...args: any[]) => Record<string, unknown>;

export interface BunRPCPlugin<
  TName extends string = string,
  TOptions = unknown,
  TMethods extends object = Record<string, never>,
  TProcedureMeta extends object = Record<string, never>,
  TExtension = unknown,
  _TContextExtensions extends Record<string, unknown> = Record<string, never>,
  _TRequestSource extends string = never,
  THandlerMethods extends object = Record<string, never>,
> {
  /** Terminal handler variants that attach metadata and then call `.handler(...)`. */
  handlerMethods?: THandlerMethods;
  /** Optional visibility hook for the normal Bun HTTP route surface. */
  includeProcedureInHttpRoutes?: (
    procedure: BunRPCPluginProcedureInfo<TProcedureMeta>
  ) => boolean;
  /** Chainable builder methods that only attach metadata. */
  methods?: TMethods;
  /** Stable plugin id used in `http.plugins.<name>`. */
  name: TName;
  /** Plugin-local options captured when attaching it with `b.use(...)`. */
  options: TOptions;
  /** Runs during `createHttpRoutes(...)` and can add routes and typed extensions. */
  setup?: (
    ctx: BunRPCPluginSetupContext<TProcedureMeta, TOptions>
  ) => BunRPCPluginSetupResult<TExtension> | undefined;
}

export type AnyBunRPCPlugin = BunRPCPlugin<
  string,
  any,
  object,
  any,
  any,
  Record<string, unknown>,
  string,
  object
>;

export type PluginName<TPlugin extends AnyBunRPCPlugin> =
  TPlugin extends BunRPCPlugin<infer TName, any, any, any, any, any, any, any>
    ? TName
    : never;

export type PluginOptions<TPlugin extends AnyBunRPCPlugin> =
  TPlugin extends BunRPCPlugin<
    any,
    infer TOptions,
    any,
    any,
    any,
    any,
    any,
    any
  >
    ? TOptions
    : never;

export type PluginMethods<TPlugin extends AnyBunRPCPlugin> =
  TPlugin extends BunRPCPlugin<
    any,
    any,
    infer TMethods,
    any,
    any,
    any,
    any,
    any
  >
    ? TMethods
    : never;

export type PluginProcedureMeta<TPlugin extends AnyBunRPCPlugin> =
  TPlugin extends BunRPCPlugin<
    any,
    any,
    any,
    infer TProcedureMeta,
    any,
    any,
    any,
    any
  >
    ? TProcedureMeta
    : never;

export type PluginExtension<TPlugin extends AnyBunRPCPlugin> =
  TPlugin extends BunRPCPlugin<
    any,
    any,
    any,
    any,
    infer TExtension,
    any,
    any,
    any
  >
    ? TExtension
    : never;

export type PluginContextExtensions<TPlugin extends AnyBunRPCPlugin> =
  TPlugin extends BunRPCPlugin<
    any,
    any,
    any,
    any,
    any,
    infer TContextExtensions,
    any,
    any
  >
    ? TContextExtensions
    : never;

export type PluginRequestSource<TPlugin extends AnyBunRPCPlugin> =
  TPlugin extends BunRPCPlugin<
    any,
    any,
    any,
    any,
    any,
    any,
    infer TRequestSource,
    any
  >
    ? TRequestSource
    : never;

export type PluginHandlerMethods<TPlugin extends AnyBunRPCPlugin> =
  TPlugin extends BunRPCPlugin<
    any,
    any,
    any,
    any,
    any,
    any,
    any,
    infer THandlerMethods
  >
    ? THandlerMethods
    : never;

export interface BunRPCPluginProcedureInfo<TMeta = never> {
  fullPath: string;
  /** Whether this procedure is visible through the regular HTTP/client API. */
  httpExposed: boolean;
  inputSchema?: StandardSchemaV1;
  /** Metadata collected for the current plugin from procedure methods. */
  meta?: TMeta;
  outputSchema?: StandardSchemaV1;
  path: string;
  procedure: AnyProcedure;
}

export interface BunRPCPluginInvokeProcedureOptions {
  context?: Record<string, unknown>;
  input?: unknown;
  req: BunRequest<string>;
  requestSource?: string;
  server: Server<unknown>;
}

export type BunRPCPluginInvokeProcedureResult = RpcResult<unknown> | Response;

export interface BunRPCPluginSetupContext<
  TProcedureMeta = never,
  TOptions = undefined,
  TRouter extends Router = Router,
> {
  /** Execute an existing procedure through bunrpc validation, middleware, and handler flow. */
  invokeProcedure: (
    procedure: BunRPCPluginProcedureInfo<TProcedureMeta>,
    options: BunRPCPluginInvokeProcedureOptions
  ) => Promise<BunRPCPluginInvokeProcedureResult>;
  options: TOptions;
  prefix: string;
  /** All procedures in the router, including plugin-hidden ones like MCP-only routes. */
  procedures: BunRPCPluginProcedureInfo<TProcedureMeta>[];
  router: TRouter;
}

export interface BunRPCPluginSetupResult<TExtension = undefined> {
  extension?: TExtension;
  routes?: Record<string, BunRPCRouteHandler>;
}

export interface ProcedurePluginEntry<
  TName extends string = string,
  TMeta extends object = Record<string, unknown>,
> {
  meta: TMeta;
  name: TName;
}

// ============================================================================
// Router types
// ============================================================================

export interface Router {
  [key: string]: unknown;
}

export type RouterPluginExtensions<
  TPlugins extends readonly AnyBunRPCPlugin[] = readonly [],
> = [TPlugins[number]] extends [never]
  ? Record<string, never>
  : {
      [TPlugin in TPlugins[number] as PluginName<TPlugin>]: PluginExtension<TPlugin>;
    };

/** Routes map returned by createHttpRoutes(...) */
export interface BunRPCRoutes<
  T extends Router,
  TPlugins extends Record<string, unknown> = Record<string, never>,
> {
  _router: T;
  plugins: TPlugins;
  routes: Record<string, BunRPCRouteHandler>;
}

// ============================================================================
// Client types - inferred from Router type only
// ============================================================================

export interface ClientRequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
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
