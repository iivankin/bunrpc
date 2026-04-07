import type { BunRequest, Server } from "bun";
import type { AnyProcedure, BunRPCHttpMethod } from "./procedure-types";
import type { RpcResult } from "./rpc-types";
import type { StandardSchemaV1 } from "./standard-schema";

export type PluginHandlerMethodPatch<
  TMeta extends object = Record<string, never>,
  THttpExposed extends boolean = true,
> = TMeta & {
  __httpExposed?: THttpExposed;
};

export type BunRPCRouteHandler = (
  req: BunRequest<string>,
  server: Server<unknown>
) => Promise<Response> | Response;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  handlerMethods?: THandlerMethods;
  includeProcedureInHttpRoutes?(
    procedure: BunRPCPluginProcedureInfo<TProcedureMeta>
  ): boolean;
  methods?: TMethods;
  name: TName;
  options: TOptions;
  setup?(
    ctx: BunRPCPluginSetupContext<TProcedureMeta, TOptions>
  ): BunRPCPluginSetupResult<TExtension> | undefined;
}

export type AnyBunRPCPlugin = BunRPCPlugin<
  string,
  unknown,
  object,
  object,
  unknown,
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
  httpExposed: boolean;
  httpMethod: BunRPCHttpMethod;
  inputSchema?: StandardSchemaV1;
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

export interface Router {
  [key: string]: unknown;
}

export interface BunRPCPluginSetupContext<
  TProcedureMeta = never,
  TOptions = undefined,
  TRouter extends Router = Router,
> {
  invokeProcedure: (
    procedure: BunRPCPluginProcedureInfo<TProcedureMeta>,
    options: BunRPCPluginInvokeProcedureOptions
  ) => Promise<BunRPCPluginInvokeProcedureResult>;
  options: TOptions;
  prefix: string;
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

export type RouterPluginExtensions<
  TPlugins extends readonly AnyBunRPCPlugin[] = readonly [],
> = [TPlugins[number]] extends [never]
  ? Record<string, never>
  : {
      [TPlugin in TPlugins[number] as PluginName<TPlugin>]: PluginExtension<TPlugin>;
    };

export interface BunRPCRoutes<
  T extends Router,
  TPlugins extends Record<string, unknown> = Record<string, never>,
> {
  _router: T;
  plugins: TPlugins;
  routes: Record<string, BunRPCRouteHandler>;
}
