import type { BunRequest, Server } from "bun";
import { BunRpcHttpError } from "./bunrpc-http-error";
import type { StandardSchemaV1 } from "./standard-schema";
import {
  type AnyBunRPCPlugin,
  type AnyProcedure,
  type AppRpcError,
  type BaseContext,
  type BunRPCRouteHandler,
  type BunRPCRoutes,
  createAppError,
  createProcedureErrorResult,
  createSystemError,
  type InferSchemaOutput,
  isProcedureErrorResult,
  type MaybePromise,
  type PluginContextExtensions,
  type PluginHandlerMethods,
  type PluginMethods,
  type PluginProcedureMeta,
  type PluginRequestSource,
  type Procedure,
  type ProcedureErrorFactory,
  type ProcedureErrorFromResult,
  type ProcedureErrorResult,
  type ProcedureHelpers,
  type ProcedureMiddlewareOptions,
  type ProcedureNextResult,
  type ProcedureNextResultOrResponse,
  type ProcedureOutputFromResult,
  type ProcedurePluginEntry,
  type ProcedureResponseFromResult,
  type Router,
  type RouterPluginExtensions,
  type RpcResult,
  type SystemRpcErrorCode,
  type UnionToIntersection,
} from "./types";

// ============================================================================
// Middleware Builder
// ============================================================================

type NormalizeMiddlewareContext<TContext> = [TContext] extends [never]
  ? Record<string, never>
  : TContext;

type NormalizeObject<TValue> = TValue extends object
  ? {
      [TKey in keyof TValue]: TValue[TKey];
    }
  : Record<string, never>;

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

type AppBaseContext<TPlugins extends readonly AnyBunRPCPlugin[]> = Omit<
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

interface ProcedureBuilderBase<
  TContext,
  TBaseContext extends BaseContext,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TError extends AppRpcError = never,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> {
  /**
   * Define handler without input
   */
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

  /**
   * Define input schema
   */
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

  /**
   * Define output schema for successful responses
   */
  output<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): ProcedureBuilder<TContext, TBaseContext, TPlugins, TError, TSchema>;
  /**
   * Add middleware that extends context
   */
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
  /**
   * Define handler with input
   */
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
  /**
   * Define output schema for successful responses
   */
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

type ProcedureBuilder<
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

const NO_INPUT_OVERRIDE = Symbol("bunrpc.noInputOverride");

type ProcedureInputOverride = typeof NO_INPUT_OVERRIDE | unknown;

const SYSTEM_RPC_ERROR_CODES = new Set<SystemRpcErrorCode>([
  "METHOD_NOT_ALLOWED",
  "INVALID_JSON",
  "VALIDATION_ERROR",
  "HTTP_ERROR",
  "INTERNAL_SERVER_ERROR",
]);

function isSystemRpcErrorCode(value: string): value is SystemRpcErrorCode {
  return SYSTEM_RPC_ERROR_CODES.has(value as SystemRpcErrorCode);
}

function createProcedureHelpers(): ProcedureHelpers {
  const error: ProcedureErrorFactory = (input) =>
    createProcedureErrorResult(input);
  return { error };
}

function isProcedureMetaPatch(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveHandlerMethodPatch(patch: Record<string, unknown>): {
  metaPatch: Record<string, unknown>;
  httpExposed: boolean;
} {
  const { __httpExposed, ...metaPatch } = patch;

  return {
    metaPatch,
    httpExposed: typeof __httpExposed === "boolean" ? __httpExposed : true,
  };
}

const RESERVED_PROCEDURE_METHOD_NAMES = new Set([
  "use",
  "input",
  "output",
  "handler",
]);

const procedurePluginMetaStore = new WeakMap<
  AnyProcedure,
  Map<string, unknown>
>();

function assertPluginCompatibility(
  plugins: readonly AnyBunRPCPlugin[],
  plugin: AnyBunRPCPlugin
): void {
  if (plugins.some((entry) => entry.name === plugin.name)) {
    throw new Error(`bunrpc plugin "${plugin.name}" is already registered`);
  }

  const pluginMethodNames = Object.keys(plugin.methods ?? {});
  const pluginHandlerMethodNames = Object.keys(plugin.handlerMethods ?? {});
  const methodNames = [...pluginMethodNames, ...pluginHandlerMethodNames];
  const seenMethodNames = new Set<string>();

  for (const methodName of methodNames) {
    if (seenMethodNames.has(methodName)) {
      throw new Error(
        `Procedure plugin method "${methodName}" is defined multiple times in "${plugin.name}"`
      );
    }

    seenMethodNames.add(methodName);

    if (RESERVED_PROCEDURE_METHOD_NAMES.has(methodName)) {
      throw new Error(
        `Procedure plugin method "${methodName}" from "${plugin.name}" conflicts with a built-in builder method`
      );
    }

    for (const existingPlugin of plugins) {
      const existingMethod =
        (existingPlugin.methods as Record<string, unknown> | undefined)?.[
          methodName
        ] ??
        (
          existingPlugin.handlerMethods as Record<string, unknown> | undefined
        )?.[methodName];

      if (existingMethod) {
        throw new Error(
          `Procedure plugin method "${methodName}" is defined by both "${existingPlugin.name}" and "${plugin.name}"`
        );
      }
    }
  }
}

function setProcedurePluginMeta(
  procedure: AnyProcedure,
  entries: readonly ProcedurePluginEntry[]
): void {
  if (entries.length === 0) {
    return;
  }

  const metaByPluginName = new Map<string, unknown>();

  for (const entry of entries) {
    metaByPluginName.set(entry.name, entry.meta);
  }

  procedurePluginMetaStore.set(procedure, metaByPluginName);
}

function getProcedurePluginMeta<TPlugin extends AnyBunRPCPlugin>(
  procedure: AnyProcedure,
  plugin: TPlugin
): PluginProcedureMeta<TPlugin> | undefined {
  return procedurePluginMetaStore.get(procedure)?.get(plugin.name) as
    | PluginProcedureMeta<TPlugin>
    | undefined;
}

function mergeProcedurePluginMeta(
  entries: readonly ProcedurePluginEntry[],
  pluginName: string,
  patch: Record<string, unknown>
): readonly ProcedurePluginEntry[] {
  const existingIndex = entries.findIndex((entry) => entry.name === pluginName);

  if (existingIndex === -1) {
    return [
      ...entries,
      {
        name: pluginName,
        meta: patch,
      },
    ];
  }

  const nextEntries = [...entries];
  const existingEntry = nextEntries[existingIndex];
  if (!existingEntry) {
    return entries;
  }

  nextEntries[existingIndex] = {
    name: pluginName,
    meta: {
      ...(existingEntry.meta as Record<string, unknown>),
      ...patch,
    },
  };

  return nextEntries;
}

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

function createProcedureBuilder<
  TContext,
  TBaseContext extends BaseContext,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TError extends AppRpcError,
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
>(
  plugins: TPlugins,
  middlewares: RuntimeMiddleware[],
  pluginEntries: readonly ProcedurePluginEntry[] = [],
  outputSchema?: TOutputSchema
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
      const nextBuilder = createProcedureBuilder<
        TContext & NormalizeMiddlewareContext<TContextExtension>,
        TBaseContext,
        TPlugins,
        TError | TNextError,
        TOutputSchema
      >(
        plugins,
        [...middlewares, value as RuntimeMiddleware],
        pluginEntries,
        outputSchema
      );

      return nextBuilder as unknown;
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
          >(plugins, middlewares, pluginEntries, nextOutputSchema).input(
            schema
          );
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
            outputSchema
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
            outputSchema
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
      >(plugins, middlewares, pluginEntries, nextOutputSchema);
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
        outputSchema
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
        outputSchema
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

// ============================================================================
// Router
// ============================================================================

interface RouterRuntimeMetadata {
  appId: symbol;
  options: InitBunRpcOptions;
  plugins: readonly AnyBunRPCPlugin[];
}

const routerRuntimeMetadataStore = new WeakMap<Router, RouterRuntimeMetadata>();

function isRouterObject(value: unknown): value is Router {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRouterRuntimeMetadata(
  router: Router
): RouterRuntimeMetadata | undefined {
  return routerRuntimeMetadataStore.get(router);
}

function assertRouterCompatibility(
  router: Router,
  appId: symbol,
  visited: WeakSet<object> = new WeakSet()
): void {
  if (visited.has(router)) {
    return;
  }

  visited.add(router);

  for (const value of Object.values(router)) {
    if (!isRouterObject(value) || isProcedure(value)) {
      continue;
    }

    const childMetadata = getRouterRuntimeMetadata(value);
    if (childMetadata && childMetadata.appId !== appId) {
      throw new Error(
        "Cannot mix bunrpc routers created by different initBunRpc() instances"
      );
    }

    assertRouterCompatibility(value, appId, visited);
  }
}

function createRouterFactory<
  TPlugins extends readonly AnyBunRPCPlugin[],
>(metadata: { appId: symbol; options: InitBunRpcOptions; plugins: TPlugins }) {
  return function router<TRouter extends Router>(procedures: TRouter): TRouter {
    assertRouterCompatibility(procedures, metadata.appId);
    routerRuntimeMetadataStore.set(procedures, metadata);
    return procedures;
  };
}

export interface InitBunRpcOptions {
  formatInternalServerError?: (
    error: unknown,
    event: BunRPCRouteErrorEvent
  ) => {
    message?: string;
    details?: unknown;
  };
  prefix?: string;
}

export interface BunRPCApp<
  TPlugins extends readonly AnyBunRPCPlugin[] = readonly [],
> {
  createHttpRoutes: <TRouter extends Router>(
    router: TRouter
  ) => BunRPCRoutes<TRouter, RouterPluginExtensions<TPlugins>>;
  publicProcedure: ProcedureBuilder<
    Record<string, never>,
    AppBaseContext<TPlugins>,
    TPlugins,
    never
  >;
  router: <TRouter extends Router>(procedures: TRouter) => TRouter;
  use<TPlugin extends AnyBunRPCPlugin>(
    plugin: TPlugin
  ): BunRPCApp<[...TPlugins, TPlugin]>;
}

export function initBunRpc<
  TPlugins extends readonly AnyBunRPCPlugin[] = readonly [],
>(
  options: InitBunRpcOptions = {},
  plugins: TPlugins = [] as unknown as TPlugins,
  appId: symbol = Symbol("bunrpc.app")
): BunRPCApp<TPlugins> {
  const router = createRouterFactory({
    appId,
    options,
    plugins,
  });
  const app: BunRPCApp<TPlugins> = {
    use<TPlugin extends AnyBunRPCPlugin>(plugin: TPlugin) {
      assertPluginCompatibility(plugins, plugin);
      return initBunRpc(
        options,
        [...plugins, plugin] as [...TPlugins, TPlugin],
        appId
      );
    },
    publicProcedure: createProcedureBuilder<
      Record<string, never>,
      AppBaseContext<TPlugins>,
      TPlugins,
      never
    >(plugins, []),
    router,
    createHttpRoutes: <TRouter extends Router>(appRouter: TRouter) =>
      buildHttpRoutes(appRouter, plugins, options),
  };

  return app;
}

// ============================================================================
// Bun Routes Generator
// ============================================================================

function isProcedure(value: unknown): value is AnyProcedure {
  return (
    typeof value === "object" &&
    value !== null &&
    "_type" in value &&
    value._type === "procedure"
  );
}

/**
 * Collect all procedures from router with their paths
 */
function collectProcedures(
  router: Router,
  prefix = ""
): Array<{ path: string; procedure: AnyProcedure }> {
  const result: Array<{ path: string; procedure: AnyProcedure }> = [];

  for (const [key, value] of Object.entries(router)) {
    const path = prefix ? `${prefix}/${key}` : key;

    if (isProcedure(value)) {
      result.push({ path, procedure: value });
    } else if (typeof value === "object" && value !== null) {
      result.push(...collectProcedures(value as Router, path));
    }
  }

  return result;
}

function registerRoute(
  routes: Record<
    string,
    (req: BunRequest<string>, server: Server<unknown>) => Promise<Response>
  >,
  path: string,
  handler: BunRPCRouteHandler,
  source: string
): void {
  if (path in routes) {
    throw new Error(`Route "${path}" is already registered (${source})`);
  }

  routes[path] = async (req: BunRequest<string>, server: Server<unknown>) =>
    Promise.resolve(handler(req, server));
}

function formatIssuePath(
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>
): string {
  if (!path || path.length === 0) {
    return "(root)";
  }

  return path
    .map((segment) => {
      if (typeof segment === "object" && segment !== null && "key" in segment) {
        return String(segment.key);
      }

      return String(segment);
    })
    .join(".");
}

interface ExecuteProcedureOptions {
  context?: Record<string, unknown>;
  formatInternalServerError?: (
    error: unknown,
    event: BunRPCRouteErrorEvent
  ) => {
    message?: string;
    details?: unknown;
  };
  fullPath: string;
  inputOverride?: ProcedureInputOverride;
  procedure: AnyProcedure;
  req: BunRequest<string>;
  requestSource?: string;
  server: Server<unknown>;
}

type ExecuteProcedureResult = RpcResult<unknown> | Response;

function isRawResponse(value: unknown): value is Response {
  return value instanceof Response;
}

async function executeProcedure({
  procedure,
  fullPath,
  req,
  server,
  formatInternalServerError,
  inputOverride = NO_INPUT_OVERRIDE,
  requestSource = "rpc",
  context,
}: ExecuteProcedureOptions): Promise<ExecuteProcedureResult> {
  const start = Date.now();
  const url = new URL(req.url);

  try {
    const helpers = createProcedureHelpers();
    const {
      req: _ignoredReq,
      server: _ignoredServer,
      requestSource: _ignoredRequestSource,
      ...extraContext
    } = context ?? {};
    const baseCtx: BaseContext & ProcedureHelpers & Record<string, unknown> = {
      req,
      server,
      requestSource,
      ...helpers,
      ...extraContext,
    };

    const execute = async (
      index: number,
      ctx: BaseContext & ProcedureHelpers & Record<string, unknown>
    ): Promise<ProcedureNextResultOrResponse> => {
      if (index >= procedure.middlewares.length) {
        let input: unknown;
        if (procedure.inputSchema) {
          let rawBody: unknown;
          if (inputOverride === NO_INPUT_OVERRIDE) {
            try {
              rawBody = await req.json();
            } catch {
              throw new BunRpcHttpError(400, "Invalid JSON body", undefined, {
                code: "INVALID_JSON",
              });
            }
          } else {
            rawBody = inputOverride;
          }

          const validation =
            await procedure.inputSchema["~standard"].validate(rawBody);
          if (validation.issues) {
            const issues = validation.issues.map((issue) => ({
              path: formatIssuePath(issue.path),
              message: issue.message,
            }));
            throw new BunRpcHttpError(
              400,
              "Validation failed",
              { issues },
              {
                code: "VALIDATION_ERROR",
              }
            );
          }
          input = validation.value;
        }

        const handlerResult = await procedure.handler({
          ...ctx,
          input,
        } as never);
        if (isRawResponse(handlerResult)) {
          return handlerResult;
        }

        if (isProcedureErrorResult(handlerResult)) {
          return { ok: false, error: handlerResult.error };
        }

        return { ok: true, data: handlerResult };
      }

      const middleware = procedure.middlewares[index];
      if (!middleware) {
        throw new BunRpcHttpError(
          500,
          "Middleware index out of bounds",
          undefined,
          { code: "INTERNAL_SERVER_ERROR" }
        );
      }

      let nextCalled = false;

      const middlewareResult = await middleware({
        ...ctx,
        path: fullPath,
        type: "rpc",
        next: <TContextExtension extends Record<string, unknown>>(
          contextExtension?: TContextExtension
        ) => {
          if (nextCalled) {
            throw new BunRpcHttpError(
              500,
              "Middleware next() called multiple times",
              undefined,
              { code: "INTERNAL_SERVER_ERROR" }
            );
          }

          nextCalled = true;
          const extension =
            contextExtension === undefined
              ? ({} as TContextExtension)
              : contextExtension;

          return execute(index + 1, {
            ...ctx,
            ...extension,
          }) as Promise<ProcedureNextResult<unknown, never, TContextExtension>>;
        },
      });

      if (isProcedureErrorResult(middlewareResult)) {
        return { ok: false, error: middlewareResult.error };
      }

      if (isRawResponse(middlewareResult)) {
        return middlewareResult;
      }

      if (!nextCalled) {
        throw new BunRpcHttpError(
          500,
          "Middleware must call next() or return error(...)",
          undefined,
          { code: "INTERNAL_SERVER_ERROR" }
        );
      }

      if (
        typeof middlewareResult !== "object" ||
        middlewareResult === null ||
        !("ok" in middlewareResult)
      ) {
        throw new BunRpcHttpError(
          500,
          "Middleware must return next() result",
          undefined,
          { code: "INTERNAL_SERVER_ERROR" }
        );
      }

      return middlewareResult as ProcedureNextResultOrResponse;
    };

    return await execute(0, baseCtx);
  } catch (error) {
    if (error instanceof BunRpcHttpError) {
      const payload = error.toJSON();

      return {
        ok: false,
        error:
          payload.source === "app"
            ? createAppError(payload)
            : createSystemError(
                isSystemRpcErrorCode(payload.code)
                  ? payload.code
                  : "HTTP_ERROR",
                payload.status,
                payload.message,
                payload.details
              ),
      };
    }

    const event: BunRPCRouteErrorEvent = {
      req,
      method: req.method,
      path: url.pathname,
      status: 500,
      duration: Date.now() - start,
      error: String(error),
    };

    const formatted = formatInternalServerError?.(error, event);
    return {
      ok: false,
      error: createSystemError(
        "INTERNAL_SERVER_ERROR",
        500,
        formatted?.message ?? "Internal Server Error",
        formatted?.details
      ),
    };
  }
}

/**
 * Create Bun.serve routes from router
 * Paths are generated from router structure: chat.create -> /api/chat/create
 */
export interface BunRPCRouteErrorEvent {
  duration: number;
  error?: string;
  method: string;
  path: string;
  req: BunRequest<string>;
  status: number;
}

function buildHttpRoutes<
  T extends Router,
  TPlugins extends readonly AnyBunRPCPlugin[],
>(
  router: T,
  plugins: TPlugins,
  options: InitBunRpcOptions = {}
): BunRPCRoutes<T, RouterPluginExtensions<TPlugins>> {
  const { prefix = "/api", formatInternalServerError } = options;
  const procedures = collectProcedures(router);
  const procedureInfos = procedures.map(({ path, procedure }) => ({
    path,
    fullPath: `${prefix}/${path}`,
    procedure,
    httpExposed:
      procedure._httpExposed !== false &&
      plugins.every((plugin) => {
        if (!plugin.includeProcedureInHttpRoutes) {
          return true;
        }

        return plugin.includeProcedureInHttpRoutes({
          path,
          fullPath: `${prefix}/${path}`,
          procedure,
          httpExposed: true,
          inputSchema: procedure.inputSchema,
          outputSchema: procedure.outputSchema,
          meta: getProcedurePluginMeta(procedure, plugin as never),
        });
      }),
    inputSchema: procedure.inputSchema,
    outputSchema: procedure.outputSchema,
  }));
  const routes: Record<
    string,
    (req: BunRequest<string>, server: Server<unknown>) => Promise<Response>
  > = {};

  for (const procedureInfo of procedureInfos) {
    if (!procedureInfo.httpExposed) {
      continue;
    }

    registerRoute(
      routes,
      procedureInfo.fullPath,
      async (req: BunRequest<string>, server: Server<unknown>) => {
        if (req.method !== "POST") {
          const error = createSystemError(
            "METHOD_NOT_ALLOWED",
            405,
            "Method not allowed, use POST"
          );
          return Response.json(error, { status: error.status });
        }

        const result = await executeProcedure({
          procedure: procedureInfo.procedure,
          fullPath: procedureInfo.fullPath,
          req,
          server,
          formatInternalServerError,
        });

        if (isRawResponse(result)) {
          return result;
        }

        if (!result.ok) {
          return Response.json(result.error, { status: result.error.status });
        }

        return Response.json(result.data);
      },
      `rpc procedure ${procedureInfo.fullPath}`
    );
  }

  const pluginExtensions = {} as RouterPluginExtensions<TPlugins>;

  for (const plugin of plugins) {
    const setupResult = plugin.setup?.({
      router,
      prefix,
      options: plugin.options as never,
      procedures: procedureInfos.map((procedureInfo) => ({
        ...procedureInfo,
        meta: getProcedurePluginMeta(procedureInfo.procedure, plugin as never),
      })),
      invokeProcedure: (procedureInfo, invokeOptions) =>
        executeProcedure({
          procedure: procedureInfo.procedure,
          fullPath: procedureInfo.fullPath,
          req: invokeOptions.req,
          server: invokeOptions.server,
          formatInternalServerError,
          inputOverride: invokeOptions.input,
          requestSource: invokeOptions.requestSource,
          context: invokeOptions.context,
        }),
    });

    if (setupResult?.routes) {
      for (const [path, handler] of Object.entries(setupResult.routes)) {
        registerRoute(routes, path, handler, `plugin ${plugin.name}`);
      }
    }

    (pluginExtensions as unknown as Record<string, unknown>)[plugin.name] =
      setupResult?.extension;
  }

  return {
    _router: router,
    routes,
    plugins: pluginExtensions,
  };
}

export function createHttpRoutes<TRouter extends Router>(
  router: TRouter
): BunRPCRoutes<TRouter, Record<string, unknown>> {
  const metadata = getRouterRuntimeMetadata(router);

  if (!metadata) {
    throw new Error(
      "bunrpc router is missing app metadata. Create it with initBunRpc(...).router(...) before calling createHttpRoutes(...)"
    );
  }

  assertRouterCompatibility(router, metadata.appId);

  return buildHttpRoutes(
    router,
    metadata.plugins,
    metadata.options
  ) as BunRPCRoutes<TRouter, Record<string, unknown>>;
}
