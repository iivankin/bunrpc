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
> {
  _type: "procedure";
  inputSchema?: StandardSchemaV1;
  middlewares: Array<(ctx: BaseContext) => Promise<Record<string, unknown>>>;
  handler: (ctx: TContext & { input: TInput }) => Promise<TOutput> | TOutput;
  // Type markers for inference
  _ctx: TContext;
  _input: TInput;
  _output: TOutput;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyProcedure = Procedure<any, any, any>;

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

type ClientMethod<P extends AnyProcedure> = P["_input"] extends undefined
  ? () => Promise<P["_output"]>
  : (input: P["_input"]) => Promise<P["_output"]>;

export type InferClient<T extends Router> = {
  [K in keyof T]: T[K] extends AnyProcedure
    ? ClientMethod<T[K]>
    : T[K] extends Router
      ? InferClient<T[K]>
      : never;
};
