import type { BunRequest, Server } from "bun";
import type {
  AnyProcedureNextResult,
  AppRpcError,
  ProcedureErrorResult,
  ProcedureHelpers,
  ProcedureNextResultOrResponse,
} from "./rpc-types";
import type { StandardSchemaV1 } from "./standard-schema";
import type { MaybePromise } from "./type-utils";

export interface ProcedureMiddlewareMeta {
  path: string;
  type: "rpc";
}

export type BunRPCHttpMethod =
  | "DELETE"
  | "GET"
  | "HEAD"
  | "OPTIONS"
  | "PATCH"
  | "POST"
  | "PUT"
  | "TRACE";

export type BunRPCHttpMethodInput =
  | BunRPCHttpMethod
  | Lowercase<BunRPCHttpMethod>;

export interface ProcedureRouteDefinition {
  method: BunRPCHttpMethod;
  path: string;
}

export interface BaseContext {
  req: BunRequest<any>;
  requestSource: string;
  server: Server<unknown>;
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

export interface Procedure<
  TContext = BaseContext,
  TInput = undefined,
  TOutput = unknown,
  TError extends AppRpcError = never,
  THttpExposed extends boolean = true,
> {
  _ctx: TContext;
  _error: TError;
  _httpExposed: THttpExposed;
  _input: TInput;
  _output: TOutput;
  _route?: ProcedureRouteDefinition;
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
