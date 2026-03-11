import type { BunRequest, Server } from "bun";
import { BunRpcHttpError } from "./bunrpc-http-error";
import {
  getProcedurePluginMeta,
  getRouterPluginUses,
  isProcedurePluginUse,
  setProcedurePluginMeta,
  setRouterPluginUses,
} from "./plugin";
import type { StandardSchemaV1 } from "./standard-schema";
import {
  createProcedureErrorResult,
  createSystemError,
  isProcedureErrorResult,
  type AnyProcedure,
  type AnyBunRPCPlugin,
  type AnyProcedureNextResult,
  type AppRpcError,
  type BaseContext,
  type BunRPCRouteHandler,
  type BunRPCRoutes,
  type InferSchemaOutput,
  type MaybePromise,
  type MiddlewareContextFromResult,
  type PluginProcedureMethods,
  type Procedure,
  type ProcedureErrorFromResult,
  type ProcedureErrorFactory,
  type ProcedureErrorResult,
  type ProcedureHelpers,
  type ProcedurePluginEntry,
  type ProcedurePluginUse,
  type ProcedureMiddlewareOptions,
  type ProcedureNextResult,
  type ProcedureOutputFromResult,
  type Router,
  type RouterPluginCarrier,
  type RouterPluginExtensions,
  type RouterPluginUse,
} from "./types";

// ============================================================================
// Middleware Builder
// ============================================================================

type NormalizeMiddlewareContext<TContext> = [TContext] extends [never]
  ? Record<string, never>
  : TContext;

type AnyMiddleware<TContext> = (
  opts: ProcedureMiddlewareOptions<TContext>
) => MaybePromise<unknown>;

type MiddlewareNextContext<TFn extends AnyMiddleware<any>> =
  NormalizeMiddlewareContext<
    MiddlewareContextFromResult<
      Extract<Awaited<ReturnType<TFn>>, AnyProcedureNextResult>
    >
  >;

type MiddlewareError<TFn extends AnyMiddleware<any>> = ProcedureErrorFromResult<
  Extract<Awaited<ReturnType<TFn>>, ProcedureErrorResult<AppRpcError>>
>;

type UnionToIntersection<T> = (
  T extends unknown ? (value: T) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;

type ProcedureHandlerResultConstraint<
  TOutputSchema extends StandardSchemaV1 | undefined,
> = TOutputSchema extends StandardSchemaV1
  ? InferSchemaOutput<TOutputSchema> | ProcedureErrorResult<AppRpcError>
  : unknown;

type ProcedureResolvedOutput<
  TOutputSchema extends StandardSchemaV1 | undefined,
  TResult,
> = TOutputSchema extends StandardSchemaV1
  ? InferSchemaOutput<TOutputSchema>
  : ProcedureOutputFromResult<TResult>;

type ProcedureBuilderPluginMethods<
  TContext,
  TError extends AppRpcError,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TOutputSchema extends StandardSchemaV1 | undefined,
> = UnionToIntersection<
  TPlugins[number] extends infer TPlugin
    ? TPlugin extends AnyBunRPCPlugin
      ? {
          [TKey in keyof PluginProcedureMethods<TPlugin> & string]: (
            ...args: Parameters<PluginProcedureMethods<TPlugin>[TKey]>
          ) => ProcedureBuilder<TContext, TError, TPlugins, TOutputSchema>;
        }
      : never
    : never
>;

interface ProcedureBuilderBase<
  TContext,
  TError extends AppRpcError = never,
  TPlugins extends readonly AnyBunRPCPlugin[] = [],
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> {
  /**
   * Add middleware that extends context
   */
  use<
    TFn extends AnyMiddleware<TContext>,
  >(
    fn: TFn
  ): ProcedureBuilder<
    TContext & MiddlewareNextContext<TFn>,
    TError | MiddlewareError<TFn>,
    TPlugins,
    TOutputSchema
  >;

  /**
   * Register a procedure plugin and expose its custom builder methods
   */
  use<TPlugin extends AnyBunRPCPlugin>(
    plugin: ProcedurePluginUse<TPlugin>
  ): ProcedureBuilder<
    TContext,
    TError,
    readonly [...TPlugins, TPlugin],
    TOutputSchema
  >;

  /**
   * Define input schema
   */
  input<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): ProcedureBuilderWithInput<
    TContext,
    InferSchemaOutput<TSchema>,
    TError,
    TPlugins,
    TOutputSchema
  >;

  /**
   * Define output schema for successful responses
   */
  output<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): ProcedureBuilder<TContext, TError, TPlugins, TSchema>;

  /**
   * Define handler without input
   */
  handler<TResult extends ProcedureHandlerResultConstraint<TOutputSchema>>(
    fn: (
      ctx: TContext & BaseContext & ProcedureHelpers & { input: undefined }
    ) => MaybePromise<TResult>
  ): Procedure<
    TContext & BaseContext,
    undefined,
    ProcedureResolvedOutput<TOutputSchema, TResult>,
    TError | ProcedureErrorFromResult<TResult>
  >;
}

interface ProcedureBuilderWithInputBase<
  TContext,
  TInput,
  TError extends AppRpcError = never,
  TPlugins extends readonly AnyBunRPCPlugin[] = [],
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> {
  /**
   * Define output schema for successful responses
   */
  output<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): ProcedureBuilderWithInput<TContext, TInput, TError, TPlugins, TSchema>;

  /**
   * Define handler with input
   */
  handler<TResult extends ProcedureHandlerResultConstraint<TOutputSchema>>(
    fn: (
      ctx: TContext & BaseContext & ProcedureHelpers & { input: TInput }
    ) => MaybePromise<TResult>
  ): Procedure<
    TContext & BaseContext,
    TInput,
    ProcedureResolvedOutput<TOutputSchema, TResult>,
    TError | ProcedureErrorFromResult<TResult>
  >;
}

type ProcedureBuilder<
  TContext,
  TError extends AppRpcError = never,
  TPlugins extends readonly AnyBunRPCPlugin[] = [],
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> = ProcedureBuilderBase<TContext, TError, TPlugins, TOutputSchema> &
  ProcedureBuilderPluginMethods<TContext, TError, TPlugins, TOutputSchema>;

type ProcedureBuilderWithInput<
  TContext,
  TInput,
  TError extends AppRpcError = never,
  TPlugins extends readonly AnyBunRPCPlugin[] = [],
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
> = ProcedureBuilderWithInputBase<
  TContext,
  TInput,
  TError,
  TPlugins,
  TOutputSchema
> &
  UnionToIntersection<
    TPlugins[number] extends infer TPlugin
      ? TPlugin extends AnyBunRPCPlugin
        ? {
            [TKey in keyof PluginProcedureMethods<TPlugin> & string]: (
              ...args: Parameters<PluginProcedureMethods<TPlugin>[TKey]>
            ) => ProcedureBuilderWithInput<
              TContext,
              TInput,
              TError,
              TPlugins,
              TOutputSchema
            >;
          }
        : never
      : never
  >;

type RuntimeMiddleware = (
  opts: ProcedureMiddlewareOptions<Record<string, unknown>>
) => MaybePromise<
  | ProcedureNextResult<unknown, never, Record<string, unknown>>
  | ProcedureErrorResult<AppRpcError>
>;

function createProcedureHelpers(): ProcedureHelpers {
  const error: ProcedureErrorFactory = (input) => createProcedureErrorResult(input);
  return { error };
}

function assertProcedureBuilderPlugins(
  plugins: readonly AnyBunRPCPlugin[]
): void {
  const seenPluginNames = new Set<string>();
  const seenMethodNames = new Map<string, string>();
  const reservedMethodNames = new Set(["use", "input", "output", "handler"]);

  for (const plugin of plugins) {
    if (seenPluginNames.has(plugin.name)) {
      throw new Error(`Duplicate bunrpc plugin "${plugin.name}" on procedure`);
    }

    seenPluginNames.add(plugin.name);

    for (const methodName of Object.keys(plugin.procedure ?? {})) {
      if (reservedMethodNames.has(methodName)) {
        throw new Error(
          `Procedure plugin method "${methodName}" from "${plugin.name}" conflicts with a built-in builder method`
        );
      }

      const existingPluginName = seenMethodNames.get(methodName);
      if (existingPluginName !== undefined) {
        throw new Error(
          `Procedure plugin method "${methodName}" is defined by both "${existingPluginName}" and "${plugin.name}"`
        );
      }

      seenMethodNames.set(methodName, plugin.name);
    }
  }
}

function isProcedureMetaPatch(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeProcedurePluginMeta(
  entries: readonly ProcedurePluginEntry[],
  plugin: AnyBunRPCPlugin,
  patch: Record<string, unknown>
): readonly ProcedurePluginEntry[] {
  const existingIndex = entries.findIndex(
    (entry) => entry.plugin.name === plugin.name
  );

  if (existingIndex === -1) {
    return [
      ...entries,
      {
        plugin,
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
    plugin,
    meta: {
      ...(existingEntry.meta as Record<string, unknown>),
      ...patch,
    },
  };

  return nextEntries;
}

function applyProcedurePluginMethods<
  TBuilder extends Record<string, unknown>,
  TPlugins extends readonly AnyBunRPCPlugin[],
>(
  builder: TBuilder,
  plugins: TPlugins,
  createNextBuilder: (
    plugin: AnyBunRPCPlugin,
    patch: Record<string, unknown>
  ) => TBuilder
): TBuilder {
  const target = builder as Record<string, unknown>;

  for (const plugin of plugins) {
    const procedureMethods = Object.entries(plugin.procedure ?? {}) as Array<
      [string, (...args: unknown[]) => Record<string, unknown>]
    >;

    for (const [methodName, method] of procedureMethods) {
      target[methodName] = (...args: unknown[]) => {
        const patch = method(...args);

        if (!isProcedureMetaPatch(patch)) {
          throw new Error(
            `Procedure plugin method "${plugin.name}.${methodName}" must return an object metadata patch`
          );
        }

        return createNextBuilder(plugin, patch);
      };
    }
  }

  return builder;
}

/**
 * Create a procedure builder with middleware chain
 */
export function createProcedure(): ProcedureBuilder<Record<string, never>, never> {
  return createProcedureBuilder([], [] as const);
}

function createProcedureBuilder<
  TContext,
  TError extends AppRpcError,
  TPlugins extends readonly AnyBunRPCPlugin[],
  TOutputSchema extends StandardSchemaV1 | undefined = undefined,
>(
  middlewares: RuntimeMiddleware[],
  plugins: TPlugins,
  pluginEntries: readonly ProcedurePluginEntry[] = [],
  outputSchema?: TOutputSchema
): ProcedureBuilder<TContext, TError, TPlugins, TOutputSchema> {
  const builder = {
    use(
      value: AnyMiddleware<TContext> | ProcedurePluginUse<AnyBunRPCPlugin>
    ): unknown {
      if (isProcedurePluginUse(value)) {
        const nextPlugins = [...plugins, value.plugin] as const;
        assertProcedureBuilderPlugins(nextPlugins);

        return createProcedureBuilder<
          TContext,
          TError,
          typeof nextPlugins,
          TOutputSchema
        >(
          middlewares,
          nextPlugins,
          pluginEntries,
          outputSchema
        );
      }

      const nextBuilder = createProcedureBuilder([
        ...middlewares,
        value as RuntimeMiddleware,
      ], plugins, pluginEntries, outputSchema);

      return nextBuilder as unknown;
    },

    input<TSchema extends StandardSchemaV1>(
      schema: TSchema
    ): ProcedureBuilderWithInput<
      TContext,
      InferSchemaOutput<TSchema>,
      TError,
      TPlugins,
      TOutputSchema
    > {
      const inputBuilder = {
        output<TNextOutputSchema extends StandardSchemaV1>(
          nextOutputSchema: TNextOutputSchema
        ): ProcedureBuilderWithInput<
          TContext,
          InferSchemaOutput<TSchema>,
          TError,
          TPlugins,
          TNextOutputSchema
        > {
          return createProcedureBuilder<
            TContext,
            TError,
            TPlugins,
            TNextOutputSchema
          >(
            middlewares,
            plugins,
            pluginEntries,
            nextOutputSchema
          ).input(schema);
        },

        handler<TResult extends ProcedureHandlerResultConstraint<TOutputSchema>>(
          fn: (
            ctx: TContext &
              BaseContext &
              ProcedureHelpers & { input: InferSchemaOutput<TSchema> }
          ) => MaybePromise<TResult>
        ): Procedure<
          TContext & BaseContext,
          InferSchemaOutput<TSchema>,
          ProcedureResolvedOutput<TOutputSchema, TResult>,
          TError | ProcedureErrorFromResult<TResult>
        > {
          const procedure: Procedure<
            TContext & BaseContext,
            InferSchemaOutput<TSchema>,
            ProcedureResolvedOutput<TOutputSchema, TResult>,
            TError | ProcedureErrorFromResult<TResult>
          > = {
            _type: "procedure",
            inputSchema: schema,
            outputSchema,
            middlewares,
            handler: fn as Procedure<
              TContext & BaseContext,
              InferSchemaOutput<TSchema>,
              ProcedureResolvedOutput<TOutputSchema, TResult>,
              TError | ProcedureErrorFromResult<TResult>
            >["handler"],
            _ctx: {} as TContext & BaseContext,
            _input: {} as InferSchemaOutput<TSchema>,
            _output: {} as ProcedureResolvedOutput<TOutputSchema, TResult>,
            _error: {} as TError | ProcedureErrorFromResult<TResult>,
          };

          setProcedurePluginMeta(procedure, pluginEntries);
          return procedure;
        },
      };

      return applyProcedurePluginMethods(
        inputBuilder,
        plugins,
        (plugin, patch) =>
          createProcedureBuilder<TContext, TError, TPlugins, TOutputSchema>(
            middlewares,
            plugins,
            mergeProcedurePluginMeta(pluginEntries, plugin, patch),
            outputSchema
          ).input(schema) as typeof inputBuilder
      ) as unknown as ProcedureBuilderWithInput<
        TContext,
        InferSchemaOutput<TSchema>,
        TError,
        TPlugins,
        TOutputSchema
      >;
    },

    output<TNextOutputSchema extends StandardSchemaV1>(
      nextOutputSchema: TNextOutputSchema
    ): ProcedureBuilder<TContext, TError, TPlugins, TNextOutputSchema> {
      return createProcedureBuilder<
        TContext,
        TError,
        TPlugins,
        TNextOutputSchema
      >(middlewares, plugins, pluginEntries, nextOutputSchema);
    },

    handler<TResult extends ProcedureHandlerResultConstraint<TOutputSchema>>(
      fn: (
        ctx: TContext & BaseContext & ProcedureHelpers & { input: undefined }
      ) => MaybePromise<TResult>
    ): Procedure<
      TContext & BaseContext,
      undefined,
      ProcedureResolvedOutput<TOutputSchema, TResult>,
      TError | ProcedureErrorFromResult<TResult>
    > {
      const procedure: Procedure<
        TContext & BaseContext,
        undefined,
        ProcedureResolvedOutput<TOutputSchema, TResult>,
        TError | ProcedureErrorFromResult<TResult>
      > = {
        _type: "procedure",
        outputSchema,
        middlewares,
        handler: fn as Procedure<
          TContext & BaseContext,
          undefined,
          ProcedureResolvedOutput<TOutputSchema, TResult>,
          TError | ProcedureErrorFromResult<TResult>
        >["handler"],
        _ctx: {} as TContext & BaseContext,
        _input: undefined as undefined,
        _output: {} as ProcedureResolvedOutput<TOutputSchema, TResult>,
        _error: {} as TError | ProcedureErrorFromResult<TResult>,
      };

      setProcedurePluginMeta(procedure, pluginEntries);
      return procedure;
    },
  };

  return applyProcedurePluginMethods(
    builder,
    plugins,
    (plugin, patch) =>
      createProcedureBuilder<TContext, TError, TPlugins, TOutputSchema>(
        middlewares,
        plugins,
        mergeProcedurePluginMeta(pluginEntries, plugin, patch),
        outputSchema
      ) as typeof builder
  ) as unknown as ProcedureBuilder<TContext, TError, TPlugins, TOutputSchema>;
}

// ============================================================================
// Router
// ============================================================================

/**
 * Create a router from procedures
 */
export interface CreateRouterOptions<
  TPlugins extends readonly RouterPluginUse[] = readonly RouterPluginUse[],
> {
  plugins?: TPlugins;
}

export function createRouter<
  T extends Router,
  TPlugins extends readonly RouterPluginUse[] = [],
>(
  procedures: T,
  options: CreateRouterOptions<TPlugins> = {}
): T & RouterPluginCarrier<TPlugins> {
  setRouterPluginUses(procedures, options.plugins ?? []);
  return procedures as T & RouterPluginCarrier<TPlugins>;
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

function collectRouterPluginUses(router: Router): RouterPluginUse[] {
  const result: RouterPluginUse[] = [];
  const seen = new Map<string, string>();
  const visited = new WeakSet<object>();

  const visit = (node: unknown, path: string): void => {
    if (typeof node !== "object" || node === null || visited.has(node)) {
      return;
    }

    visited.add(node);

    for (const pluginUse of getRouterPluginUses(node)) {
      const existingPath = seen.get(pluginUse.plugin.name);
      if (existingPath !== undefined) {
        throw new Error(
          `Duplicate bunrpc plugin "${pluginUse.plugin.name}" registered at ${existingPath} and ${path || "(root)"}`
        );
      }

      seen.set(pluginUse.plugin.name, path || "(root)");
      result.push(pluginUse);
    }

    for (const [key, value] of Object.entries(node)) {
      if (isProcedure(value)) {
        continue;
      }

      if (typeof value === "object" && value !== null) {
        visit(value, path ? `${path}.${key}` : key);
      }
    }
  };

  visit(router, "");

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

  routes[path] = async (
    req: BunRequest<string>,
    server: Server<unknown>
  ) => Promise.resolve(handler(req, server));
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

/**
 * Create Bun.serve routes from router
 * Paths are generated from router structure: chat.create -> /api/chat/create
 */
export interface BunRPCRouteErrorEvent {
  req: BunRequest<string>;
  method: string;
  path: string;
  status: number;
  duration: number;
  error?: string;
}

export interface CreateBunRPCRoutesOptions {
  prefix?: string;
  formatInternalServerError?: (
    error: unknown,
    event: BunRPCRouteErrorEvent
  ) => {
    message?: string;
    details?: unknown;
  };
}

export function createBunRPCRoutes<T extends Router>(
  router: T,
  options: CreateBunRPCRoutesOptions = {}
): BunRPCRoutes<T, RouterPluginExtensions<T>> {
  const { prefix = "/api", formatInternalServerError } = options;
  const procedures = collectProcedures(router);
  const routes: Record<
    string,
    (req: BunRequest<string>, server: Server<unknown>) => Promise<Response>
  > = {};

  for (const { path, procedure } of procedures) {
    const fullPath = `${prefix}/${path}`;

    registerRoute(routes, fullPath, async (
      req: BunRequest<string>,
      server: Server<unknown>
    ) => {
      const start = Date.now();
      const url = new URL(req.url);

      try {
        if (req.method !== "POST") {
          throw new BunRpcHttpError(
            405,
            "Method not allowed, use POST",
            undefined,
            {
              code: "METHOD_NOT_ALLOWED",
            }
          );
        }

        const helpers = createProcedureHelpers();
        const baseCtx: BaseContext & ProcedureHelpers & Record<string, unknown> = {
          req,
          server,
          ...helpers,
        };

        const execute = async (
          index: number,
          ctx: BaseContext & ProcedureHelpers & Record<string, unknown>
        ): Promise<ProcedureNextResult> => {
          if (index >= procedure.middlewares.length) {
            let input: unknown;
            if (procedure.inputSchema) {
              let rawBody: unknown;
              try {
                rawBody = await req.json();
              } catch {
                throw new BunRpcHttpError(400, "Invalid JSON body", undefined, {
                  code: "INVALID_JSON",
                });
              }

              const validation = await procedure.inputSchema["~standard"].validate(
                rawBody
              );
              if (validation.issues) {
                const issues = validation.issues.map((issue) => ({
                  path: formatIssuePath(issue.path),
                  message: issue.message,
                }));
                throw new BunRpcHttpError(400, "Validation failed", { issues }, {
                  code: "VALIDATION_ERROR",
                });
              }
              input = validation.value;
            }

            const handlerResult = await procedure.handler({ ...ctx, input } as never);
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
            next: async <TContextExtension extends Record<string, unknown>>(
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
              }) as Promise<
                ProcedureNextResult<unknown, never, TContextExtension>
              >;
            },
          });

          if (isProcedureErrorResult(middlewareResult)) {
            return { ok: false, error: middlewareResult.error };
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

          return middlewareResult as ProcedureNextResult;
        };

        const result = await execute(0, baseCtx);

        if (!result.ok) {
          return Response.json(result.error, { status: result.error.status });
        }

        return Response.json(result.data);
      } catch (error) {
        if (error instanceof BunRpcHttpError) {
          return Response.json(error.toJSON(), { status: error.status });
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
        const payload = createSystemError(
          "INTERNAL_SERVER_ERROR",
          500,
          formatted?.message ?? "Internal Server Error",
          formatted?.details
        );

        return Response.json(payload, { status: 500 });
      }
    }, `rpc procedure ${fullPath}`);
  }

  const pluginExtensions = {} as RouterPluginExtensions<T>;
  const pluginUses = collectRouterPluginUses(router);

  for (const pluginUse of pluginUses) {
    const setupResult = pluginUse.plugin.setup?.({
      router,
      prefix,
      options: pluginUse.options,
      procedures: procedures.map(({ path, procedure }) => ({
        path,
        fullPath: `${prefix}/${path}`,
        procedure,
        inputSchema: procedure.inputSchema,
        outputSchema: procedure.outputSchema,
        meta: getProcedurePluginMeta(procedure, pluginUse.plugin),
      })),
    });

    if (setupResult?.routes) {
      for (const [path, handler] of Object.entries(setupResult.routes)) {
        registerRoute(
          routes,
          path,
          handler,
          `plugin ${pluginUse.plugin.name}`
        );
      }
    }

    (
      pluginExtensions as unknown as Record<string, unknown>
    )[pluginUse.plugin.name] = setupResult?.extension;
  }

  return {
    _router: router,
    routes,
    plugins: pluginExtensions,
  };
}
