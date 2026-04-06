import type { BunRequest } from "bun";
import type { StandardSchemaV1 } from "../standard-schema";
import type { MaybePromise } from "../type-utils";
import type {
  AnyBunRPCPlugin,
  AppRpcError,
  BaseContext,
  BunRPCHttpMethodInput,
  InferSchemaOutput,
  PluginContextExtensions,
  PluginHandlerMethods,
  PluginMethods,
  PluginRequestSource,
  Procedure,
  ProcedureErrorFromResult,
  ProcedureErrorResult,
  ProcedureHelpers,
  ProcedureMiddlewareOptions,
  ProcedureNextResultOrResponse,
  ProcedureOutputFromResult,
  ProcedurePluginEntry,
  ProcedureResponseFromResult,
  ProcedureRouteDefinition,
  UnionToIntersection,
} from "../types";
import {
  isProcedureMetaPatch,
  mergeProcedurePluginMeta,
  resolveHandlerMethodPatch,
  setProcedurePluginMeta,
} from "./plugin-meta";
import { createProcedureRouteDefinition } from "./procedure-routing";

type NormalizeMiddlewareContext<TContext> = [TContext] extends [never]
  ? Record<string, never>
  : TContext;

type NormalizeObject<TValue> = TValue extends object
  ? {
      [TKey in keyof TValue]: TValue[TKey];
    }
  : Record<string, never>;

type ReplaceBaseContextRequest<
  TBaseContext extends BaseContext,
  TPath extends string,
> = Omit<TBaseContext, "req"> & {
  req: BunRequest<TPath>;
};

type AppPluginContext<TPlugins extends readonly AnyBunRPCPlugin[]> = [
  TPlugins[number],
] extends [never]
  ? Record<string, never>
  : UnionToIntersection<
      TPlugins[number] extends infer TPlugin
        ? TPlugin extends AnyBunRPCPlugin
          ? PluginContextExtensions<TPlugin>
          : never
        : never
    >;

type AppPluginRequestSource<TPlugins extends readonly AnyBunRPCPlugin[]> =
  Extract<
    TPlugins[number] extends infer TPlugin
      ? TPlugin extends AnyBunRPCPlugin
        ? PluginRequestSource<TPlugin>
        : never
      : never,
    string
  >;

export type AppBaseContext<TPlugins extends readonly AnyBunRPCPlugin[]> = Omit<
  BaseContext,
  "requestSource"
> &
  AppPluginContext<TPlugins> & {
    requestSource: [AppPluginRequestSource<TPlugins>] extends [never]
      ? "rpc"
      : "rpc" | AppPluginRequestSource<TPlugins>;
  };

type ProcedureBuilderPluginMethodsUnion<TPlugin extends AnyBunRPCPlugin> = {
  [TMethodName in Extract<keyof PluginMethods<TPlugin>, string>]: <TSelf>(
    this: TSelf,
    ...args: Parameters<
      Extract<
        NonNullable<PluginMethods<TPlugin>[TMethodName]>,
        (...args: any[]) => any
      >
    >
  ) => TSelf;
};

type ProcedureHandlerResultConstraint<
  TOutputSchema extends StandardSchemaV1 | undefined,
> = TOutputSchema extends StandardSchemaV1
  ?
      | InferSchemaOutput<TOutputSchema>
      | ProcedureErrorResult<AppRpcError>
      | Response
  : unknown;

type ProcedureResolvedOutput<
  TOutputSchema extends StandardSchemaV1 | undefined,
  TResult,
> = TOutputSchema extends StandardSchemaV1
  ? InferSchemaOutput<TOutputSchema> | ProcedureResponseFromResult<TResult>
  : ProcedureOutputFromResult<TResult>;

type ProcedureBuilderHandlerMethodsUnion<
  TPlugin extends AnyBunRPCPlugin,
  TContext,
  TBaseContext extends BaseContext,
  TError extends AppRpcError,
  TOutputSchema extends StandardSchemaV1 | undefined,
> = {
  [TMethodName in Extract<keyof PluginHandlerMethods<TPlugin>, string>]: <
    TResult extends ProcedureHandlerResultConstraint<TOutputSchema>,
  >(
    fn: (
      ctx: TContext & TBaseContext & ProcedureHelpers & { input: undefined }
    ) => MaybePromise<TResult>
  ) => Procedure<
    TContext & TBaseContext,
    undefined,
    ProcedureResolvedOutput<TOutputSchema, TResult>,
    TError | ProcedureErrorFromResult<TResult>,
    PluginHandlerMethods<TPlugin>[TMethodName] extends {
      __httpExposed?: infer THttpExposed;
    }
      ? Extract<THttpExposed, boolean> extends never
        ? true
        : Extract<THttpExposed, boolean>
      : true
  >;
};

interface ProcedureBuilderBase<
  TContext,
  TBaseContext extends BaseContext,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TError extends AppRpcError = never,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> {
  handler<TResult extends ProcedureHandlerResultConstraint<TOutputSchema>>(
    fn: (
      ctx: TContext & TBaseContext & ProcedureHelpers & { input: undefined }
    ) => MaybePromise<TResult>
  ): Procedure<
    TContext & TBaseContext,
    undefined,
    ProcedureResolvedOutput<TOutputSchema, TResult>,
    TError | ProcedureErrorFromResult<TResult>
  >;
  input<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): ProcedureBuilderWithInput<
    TContext,
    TBaseContext,
    TPlugins,
    InferSchemaOutput<TSchema>,
    TError,
    TOutputSchema
  >;
  output<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): ProcedureBuilder<TContext, TBaseContext, TPlugins, TError, TSchema>;
  route<TPath extends string>(
    path: TPath,
    method?: BunRPCHttpMethodInput
  ): ProcedureBuilder<
    TContext,
    ReplaceBaseContextRequest<TBaseContext, TPath>,
    TPlugins,
    TError,
    TOutputSchema
  >;
  use<
    TContextExtension extends Record<string, unknown> = Record<string, never>,
    TNextError extends AppRpcError = never,
  >(
    fn: (
      opts: ProcedureMiddlewareOptions<TContext, TBaseContext>
    ) => MaybePromise<
      | ProcedureNextResultOrResponse<unknown, never, TContextExtension>
      | ProcedureErrorResult<TNextError>
    >
  ): ProcedureBuilder<
    TContext & NormalizeMiddlewareContext<TContextExtension>,
    TBaseContext,
    TPlugins,
    TError | TNextError,
    TOutputSchema
  >;
}

interface ProcedureBuilderWithInputBase<
  TContext,
  TBaseContext extends BaseContext,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TInput,
  TError extends AppRpcError = never,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> {
  handler<TResult extends ProcedureHandlerResultConstraint<TOutputSchema>>(
    fn: (
      ctx: TContext & TBaseContext & ProcedureHelpers & { input: TInput }
    ) => MaybePromise<TResult>
  ): Procedure<
    TContext & TBaseContext,
    TInput,
    ProcedureResolvedOutput<TOutputSchema, TResult>,
    TError | ProcedureErrorFromResult<TResult>
  >;
  output<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): ProcedureBuilderWithInput<
    TContext,
    TBaseContext,
    TPlugins,
    TInput,
    TError,
    TSchema
  >;
  route<TPath extends string>(
    path: TPath,
    method?: BunRPCHttpMethodInput
  ): ProcedureBuilderWithInput<
    TContext,
    ReplaceBaseContextRequest<TBaseContext, TPath>,
    TPlugins,
    TInput,
    TError,
    TOutputSchema
  >;
}

type ProcedureBuilderMethods<
  TContext,
  TBaseContext extends BaseContext,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TError extends AppRpcError,
  TOutputSchema extends StandardSchemaV1 | undefined,
> = NormalizeObject<
  UnionToIntersection<
    TPlugins[number] extends infer TPlugin
      ? TPlugin extends AnyBunRPCPlugin
        ? ProcedureBuilderPluginMethodsUnion<TPlugin> &
            ProcedureBuilderHandlerMethodsUnion<
              TPlugin,
              TContext,
              TBaseContext,
              TError,
              TOutputSchema
            >
        : never
      : never
  >
>;

export type ProcedureBuilder<
  TContext,
  TBaseContext extends BaseContext,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TError extends AppRpcError = never,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> = ProcedureBuilderBase<
  TContext,
  TBaseContext,
  TPlugins,
  TError,
  TOutputSchema
> &
  ProcedureBuilderMethods<
    TContext,
    TBaseContext,
    TPlugins,
    TError,
    TOutputSchema
  >;

type ProcedureBuilderWithInputHandlerMethodsUnion<
  TPlugin extends AnyBunRPCPlugin,
  TContext,
  TBaseContext extends BaseContext,
  TInput,
  TError extends AppRpcError,
  TOutputSchema extends StandardSchemaV1 | undefined,
> = {
  [TMethodName in Extract<keyof PluginHandlerMethods<TPlugin>, string>]: <
    TResult extends ProcedureHandlerResultConstraint<TOutputSchema>,
  >(
    fn: (
      ctx: TContext & TBaseContext & ProcedureHelpers & { input: TInput }
    ) => MaybePromise<TResult>
  ) => Procedure<
    TContext & TBaseContext,
    TInput,
    ProcedureResolvedOutput<TOutputSchema, TResult>,
    TError | ProcedureErrorFromResult<TResult>,
    PluginHandlerMethods<TPlugin>[TMethodName] extends {
      __httpExposed?: infer THttpExposed;
    }
      ? Extract<THttpExposed, boolean> extends never
        ? true
        : Extract<THttpExposed, boolean>
      : true
  >;
};

type ProcedureBuilderWithInputMethods<
  TContext,
  TBaseContext extends BaseContext,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TInput,
  TError extends AppRpcError,
  TOutputSchema extends StandardSchemaV1 | undefined,
> = NormalizeObject<
  UnionToIntersection<
    TPlugins[number] extends infer TPlugin
      ? TPlugin extends AnyBunRPCPlugin
        ? ProcedureBuilderPluginMethodsUnion<TPlugin> &
            ProcedureBuilderWithInputHandlerMethodsUnion<
              TPlugin,
              TContext,
              TBaseContext,
              TInput,
              TError,
              TOutputSchema
            >
        : never
      : never
  >
>;

type ProcedureBuilderWithInput<
  TContext,
  TBaseContext extends BaseContext,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TInput,
  TError extends AppRpcError = never,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> = ProcedureBuilderWithInputBase<
  TContext,
  TBaseContext,
  TPlugins,
  TInput,
  TError,
  TOutputSchema
> &
  ProcedureBuilderWithInputMethods<
    TContext,
    TBaseContext,
    TPlugins,
    TInput,
    TError,
    TOutputSchema
  >;

type RuntimeMiddleware = (
  opts: ProcedureMiddlewareOptions<Record<string, unknown>, BaseContext>
) => MaybePromise<
  | ProcedureNextResultOrResponse<unknown, never, Record<string, unknown>>
  | ProcedureErrorResult<AppRpcError>
>;

export const NO_INPUT_OVERRIDE = Symbol("bunrpc.noInputOverride");

export type ProcedureInputOverride = typeof NO_INPUT_OVERRIDE | unknown;

function applyProcedurePluginMethods<TBuilder extends Record<string, unknown>>(
  plugins: readonly AnyBunRPCPlugin[],
  builder: TBuilder,
  createNextBuilder: (
    pluginName: string,
    patch: Record<string, unknown>
  ) => TBuilder,
  createHandler: (
    pluginName: string,
    patch: Record<string, unknown>,
    httpExposed: boolean,
    fn: unknown
  ) => unknown
): TBuilder {
  const target = builder as Record<string, unknown>;

  for (const plugin of plugins) {
    for (const [methodName, method] of Object.entries(plugin.methods ?? {})) {
      if (typeof method !== "function") {
        continue;
      }

      target[methodName] = (...args: unknown[]) => {
        const patch = method(...args);

        if (!isProcedureMetaPatch(patch)) {
          throw new Error(
            `Procedure plugin method "${plugin.name}.${methodName}" must return an object metadata patch`
          );
        }

        return createNextBuilder(plugin.name, patch);
      };
    }

    for (const [methodName, patch] of Object.entries(
      plugin.handlerMethods ?? {}
    )) {
      if (!isProcedureMetaPatch(patch)) {
        throw new Error(
          `Procedure plugin handler method "${plugin.name}.${methodName}" must be configured with an object metadata patch`
        );
      }

      target[methodName] = (fn: unknown) => {
        const resolvedPatch = resolveHandlerMethodPatch(patch);

        return createHandler(
          plugin.name,
          resolvedPatch.metaPatch,
          resolvedPatch.httpExposed,
          fn
        );
      };
    }
  }

  return builder;
}

export function createProcedureBuilder<
  TContext,
  TBaseContext extends BaseContext,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TError extends AppRpcError,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
>(
  plugins: TPlugins,
  middlewares: RuntimeMiddleware[],
  pluginEntries: readonly ProcedurePluginEntry[] = [],
  outputSchema?: TOutputSchema,
  route?: ProcedureRouteDefinition
): ProcedureBuilder<TContext, TBaseContext, TPlugins, TError, TOutputSchema> {
  const builder = {
    use<
      TContextExtension extends Record<string, unknown> = Record<string, never>,
      TNextError extends AppRpcError = never,
    >(
      value: (
        opts: ProcedureMiddlewareOptions<TContext, TBaseContext>
      ) => MaybePromise<
        | ProcedureNextResultOrResponse<unknown, never, TContextExtension>
        | ProcedureErrorResult<TNextError>
      >
    ): unknown {
      return createProcedureBuilder<
        TContext & NormalizeMiddlewareContext<TContextExtension>,
        TBaseContext,
        TPlugins,
        TError | TNextError,
        TOutputSchema
      >(
        plugins,
        [...middlewares, value as RuntimeMiddleware],
        pluginEntries,
        outputSchema,
        route
      ) as unknown;
    },

    route<TPath extends string>(
      path: TPath,
      method: BunRPCHttpMethodInput = "POST"
    ): ProcedureBuilder<
      TContext,
      ReplaceBaseContextRequest<TBaseContext, TPath>,
      TPlugins,
      TError,
      TOutputSchema
    > {
      return createProcedureBuilder<
        TContext,
        ReplaceBaseContextRequest<TBaseContext, TPath>,
        TPlugins,
        TError,
        TOutputSchema
      >(
        plugins,
        middlewares,
        pluginEntries,
        outputSchema,
        createProcedureRouteDefinition(path, method)
      );
    },

    input<TSchema extends StandardSchemaV1>(
      schema: TSchema
    ): ProcedureBuilderWithInput<
      TContext,
      TBaseContext,
      TPlugins,
      InferSchemaOutput<TSchema>,
      TError,
      TOutputSchema
    > {
      const inputBuilder = {
        output<TNextOutputSchema extends StandardSchemaV1>(
          nextOutputSchema: TNextOutputSchema
        ): ProcedureBuilderWithInput<
          TContext,
          TBaseContext,
          TPlugins,
          InferSchemaOutput<TSchema>,
          TError,
          TNextOutputSchema
        > {
          return createProcedureBuilder<
            TContext,
            TBaseContext,
            TPlugins,
            TError,
            TNextOutputSchema
          >(plugins, middlewares, pluginEntries, nextOutputSchema, route).input(
            schema
          );
        },

        route<TPath extends string>(
          path: TPath,
          method: BunRPCHttpMethodInput = "POST"
        ): ProcedureBuilderWithInput<
          TContext,
          ReplaceBaseContextRequest<TBaseContext, TPath>,
          TPlugins,
          InferSchemaOutput<TSchema>,
          TError,
          TOutputSchema
        > {
          return createProcedureBuilder<
            TContext,
            ReplaceBaseContextRequest<TBaseContext, TPath>,
            TPlugins,
            TError,
            TOutputSchema
          >(
            plugins,
            middlewares,
            pluginEntries,
            outputSchema,
            createProcedureRouteDefinition(path, method)
          ).input(schema);
        },

        handler<
          TResult extends ProcedureHandlerResultConstraint<TOutputSchema>,
        >(
          fn: (
            ctx: TContext &
              TBaseContext &
              ProcedureHelpers & { input: InferSchemaOutput<TSchema> }
          ) => MaybePromise<TResult>
        ): Procedure<
          TContext & TBaseContext,
          InferSchemaOutput<TSchema>,
          ProcedureResolvedOutput<TOutputSchema, TResult>,
          TError | ProcedureErrorFromResult<TResult>
        > {
          const procedure: Procedure<
            TContext & TBaseContext,
            InferSchemaOutput<TSchema>,
            ProcedureResolvedOutput<TOutputSchema, TResult>,
            TError | ProcedureErrorFromResult<TResult>
          > = {
            _type: "procedure",
            inputSchema: schema,
            outputSchema,
            middlewares,
            handler: fn as Procedure<
              TContext & TBaseContext,
              InferSchemaOutput<TSchema>,
              ProcedureResolvedOutput<TOutputSchema, TResult>,
              TError | ProcedureErrorFromResult<TResult>
            >["handler"],
            _ctx: {} as TContext & TBaseContext,
            _input: {} as InferSchemaOutput<TSchema>,
            _output: {} as ProcedureResolvedOutput<TOutputSchema, TResult>,
            _error: {} as TError | ProcedureErrorFromResult<TResult>,
            _httpExposed: true,
            _route: route,
          };

          setProcedurePluginMeta(procedure, pluginEntries);
          return procedure;
        },
      };

      return applyProcedurePluginMethods(
        plugins,
        inputBuilder,
        (pluginName, patch) =>
          createProcedureBuilder<
            TContext,
            TBaseContext,
            TPlugins,
            TError,
            TOutputSchema
          >(
            plugins,
            middlewares,
            mergeProcedurePluginMeta(pluginEntries, pluginName, patch),
            outputSchema,
            route
          ).input(schema) as typeof inputBuilder,
        (pluginName, patch, httpExposed, fn) => {
          const procedure = createProcedureBuilder<
            TContext,
            TBaseContext,
            TPlugins,
            TError,
            TOutputSchema
          >(
            plugins,
            middlewares,
            mergeProcedurePluginMeta(pluginEntries, pluginName, patch),
            outputSchema,
            route
          )
            .input(schema)
            .handler(fn as never);

          procedure._httpExposed = httpExposed as typeof procedure._httpExposed;
          return procedure;
        }
      ) as unknown as ProcedureBuilderWithInput<
        TContext,
        TBaseContext,
        TPlugins,
        InferSchemaOutput<TSchema>,
        TError,
        TOutputSchema
      >;
    },

    output<TNextOutputSchema extends StandardSchemaV1>(
      nextOutputSchema: TNextOutputSchema
    ): ProcedureBuilder<
      TContext,
      TBaseContext,
      TPlugins,
      TError,
      TNextOutputSchema
    > {
      return createProcedureBuilder<
        TContext,
        TBaseContext,
        TPlugins,
        TError,
        TNextOutputSchema
      >(plugins, middlewares, pluginEntries, nextOutputSchema, route);
    },

    handler<TResult extends ProcedureHandlerResultConstraint<TOutputSchema>>(
      fn: (
        ctx: TContext & TBaseContext & ProcedureHelpers & { input: undefined }
      ) => MaybePromise<TResult>
    ): Procedure<
      TContext & TBaseContext,
      undefined,
      ProcedureResolvedOutput<TOutputSchema, TResult>,
      TError | ProcedureErrorFromResult<TResult>
    > {
      const procedure: Procedure<
        TContext & TBaseContext,
        undefined,
        ProcedureResolvedOutput<TOutputSchema, TResult>,
        TError | ProcedureErrorFromResult<TResult>
      > = {
        _type: "procedure",
        outputSchema,
        middlewares,
        handler: fn as Procedure<
          TContext & TBaseContext,
          undefined,
          ProcedureResolvedOutput<TOutputSchema, TResult>,
          TError | ProcedureErrorFromResult<TResult>
        >["handler"],
        _ctx: {} as TContext & TBaseContext,
        _input: undefined as undefined,
        _output: {} as ProcedureResolvedOutput<TOutputSchema, TResult>,
        _error: {} as TError | ProcedureErrorFromResult<TResult>,
        _httpExposed: true,
        _route: route,
      };

      setProcedurePluginMeta(procedure, pluginEntries);
      return procedure;
    },
  };

  return applyProcedurePluginMethods(
    plugins,
    builder,
    (pluginName, patch) =>
      createProcedureBuilder<
        TContext,
        TBaseContext,
        TPlugins,
        TError,
        TOutputSchema
      >(
        plugins,
        middlewares,
        mergeProcedurePluginMeta(pluginEntries, pluginName, patch),
        outputSchema,
        route
      ) as typeof builder,
    (pluginName, patch, httpExposed, fn) => {
      const procedure = createProcedureBuilder<
        TContext,
        TBaseContext,
        TPlugins,
        TError,
        TOutputSchema
      >(
        plugins,
        middlewares,
        mergeProcedurePluginMeta(pluginEntries, pluginName, patch),
        outputSchema,
        route
      ).handler(fn as never);

      procedure._httpExposed = httpExposed as typeof procedure._httpExposed;
      return procedure;
    }
  ) as unknown as ProcedureBuilder<
    TContext,
    TBaseContext,
    TPlugins,
    TError,
    TOutputSchema
  >;
}
