import type { BunRequest, Server } from "bun";
import { BunRpcHttpError } from "./bunrpc-http-error";
import type { StandardSchemaV1 } from "./standard-schema";
import {
  createProcedureErrorResult,
  createSystemError,
  isProcedureErrorResult,
  type AnyProcedure,
  type AnyProcedureNextResult,
  type AppRpcError,
  type BaseContext,
  type BunRPCRoutes,
  type InferSchemaOutput,
  type MaybePromise,
  type MiddlewareContextFromResult,
  type Procedure,
  type ProcedureErrorFromResult,
  type ProcedureErrorFactory,
  type ProcedureErrorResult,
  type ProcedureHelpers,
  type ProcedureMiddlewareOptions,
  type ProcedureNextResult,
  type ProcedureOutputFromResult,
  type Router,
} from "./types";

// ============================================================================
// Middleware Builder
// ============================================================================

type NormalizeMiddlewareContext<TContext> = [TContext] extends [never]
  ? Record<string, never>
  : TContext;

interface ProcedureBuilder<TContext, TError extends AppRpcError = never> {
  /**
   * Add middleware that extends context
   */
  use<TFn extends (opts: ProcedureMiddlewareOptions<TContext>) => Promise<unknown>>(
    fn: TFn
  ): ProcedureBuilder<
    TContext &
      NormalizeMiddlewareContext<
        MiddlewareContextFromResult<
          Extract<Awaited<ReturnType<TFn>>, AnyProcedureNextResult>
        >
      >,
    TError |
      ProcedureErrorFromResult<
        Extract<
          Awaited<ReturnType<TFn>>,
          ProcedureErrorResult<AppRpcError>
        >
      >
  >;

  /**
   * Define input schema
   */
  input<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): ProcedureBuilderWithInput<
    TContext,
    InferSchemaOutput<TSchema>,
    TError
  >;

  /**
   * Define handler without input
   */
  handler<TResult>(
    fn: (
      ctx: TContext & BaseContext & ProcedureHelpers & { input: undefined }
    ) => MaybePromise<TResult>
  ): Procedure<
    TContext & BaseContext,
    undefined,
    ProcedureOutputFromResult<TResult>,
    TError | ProcedureErrorFromResult<TResult>
  >;
}

interface ProcedureBuilderWithInput<
  TContext,
  TInput,
  TError extends AppRpcError = never,
> {
  /**
   * Define handler with input
   */
  handler<TResult>(
    fn: (
      ctx: TContext & BaseContext & ProcedureHelpers & { input: TInput }
    ) => MaybePromise<TResult>
  ): Procedure<
    TContext & BaseContext,
    TInput,
    ProcedureOutputFromResult<TResult>,
    TError | ProcedureErrorFromResult<TResult>
  >;
}

type RuntimeMiddleware = (
  opts: ProcedureMiddlewareOptions<Record<string, unknown>>
) => Promise<
  | ProcedureNextResult<unknown, never, Record<string, unknown>>
  | ProcedureErrorResult<AppRpcError>
>;

function createProcedureHelpers(): ProcedureHelpers {
  const error: ProcedureErrorFactory = (input) => createProcedureErrorResult(input);
  return { error };
}

/**
 * Create a procedure builder with middleware chain
 */
export function createProcedure(): ProcedureBuilder<Record<string, never>, never> {
  return createProcedureBuilder([]);
}

function createProcedureBuilder<TContext, TError extends AppRpcError>(
  middlewares: RuntimeMiddleware[]
): ProcedureBuilder<TContext, TError> {
  const builder = {
    use<TFn extends (opts: ProcedureMiddlewareOptions<TContext>) => Promise<unknown>>(
      fn: TFn
    ): ProcedureBuilder<
      TContext &
        NormalizeMiddlewareContext<
          MiddlewareContextFromResult<
            Extract<Awaited<ReturnType<TFn>>, AnyProcedureNextResult>
          >
        >,
      TError |
        ProcedureErrorFromResult<
          Extract<
            Awaited<ReturnType<TFn>>,
            ProcedureErrorResult<AppRpcError>
          >
        >
    > {
      const nextBuilder = createProcedureBuilder([
        ...middlewares,
        fn as RuntimeMiddleware,
      ]);

      return nextBuilder as unknown as ProcedureBuilder<
        TContext &
          NormalizeMiddlewareContext<
            MiddlewareContextFromResult<
              Extract<Awaited<ReturnType<TFn>>, AnyProcedureNextResult>
            >
          >,
        TError |
          ProcedureErrorFromResult<
            Extract<
              Awaited<ReturnType<TFn>>,
              ProcedureErrorResult<AppRpcError>
            >
          >
      >;
    },

    input<TSchema extends StandardSchemaV1>(
      schema: TSchema
    ): ProcedureBuilderWithInput<TContext, InferSchemaOutput<TSchema>, TError> {
      return {
        handler<TResult>(
          fn: (
            ctx: TContext &
              BaseContext &
              ProcedureHelpers & { input: InferSchemaOutput<TSchema> }
          ) => MaybePromise<TResult>
        ): Procedure<
          TContext & BaseContext,
          InferSchemaOutput<TSchema>,
          ProcedureOutputFromResult<TResult>,
          TError | ProcedureErrorFromResult<TResult>
        > {
          return {
            _type: "procedure",
            inputSchema: schema,
            middlewares,
            handler: fn as Procedure<
              TContext & BaseContext,
              InferSchemaOutput<TSchema>,
              ProcedureOutputFromResult<TResult>,
              TError | ProcedureErrorFromResult<TResult>
            >["handler"],
            _ctx: {} as TContext & BaseContext,
            _input: {} as InferSchemaOutput<TSchema>,
            _output: {} as ProcedureOutputFromResult<TResult>,
            _error: {} as TError | ProcedureErrorFromResult<TResult>,
          };
        },
      };
    },

    handler<TResult>(
      fn: (
        ctx: TContext & BaseContext & ProcedureHelpers & { input: undefined }
      ) => MaybePromise<TResult>
    ): Procedure<
      TContext & BaseContext,
      undefined,
      ProcedureOutputFromResult<TResult>,
      TError | ProcedureErrorFromResult<TResult>
    > {
      return {
        _type: "procedure",
        middlewares,
        handler: fn as Procedure<
          TContext & BaseContext,
          undefined,
          ProcedureOutputFromResult<TResult>,
          TError | ProcedureErrorFromResult<TResult>
        >["handler"],
        _ctx: {} as TContext & BaseContext,
        _input: undefined as undefined,
        _output: {} as ProcedureOutputFromResult<TResult>,
        _error: {} as TError | ProcedureErrorFromResult<TResult>,
      };
    },
  };

  return builder as unknown as ProcedureBuilder<TContext, TError>;
}

// ============================================================================
// Router
// ============================================================================

/**
 * Create a router from procedures
 */
export function createRouter<T extends Router>(procedures: T): T {
  return procedures;
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
): BunRPCRoutes<T> {
  const { prefix = "/api", formatInternalServerError } = options;
  const procedures = collectProcedures(router);
  const routes: Record<
    string,
    (req: BunRequest<string>, server: Server<unknown>) => Promise<Response>
  > = {};

  for (const { path, procedure } of procedures) {
    const fullPath = `${prefix}/${path}`;

    routes[fullPath] = async (
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
    };
  }

  return {
    _router: router,
    routes,
  };
}
