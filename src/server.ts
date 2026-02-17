import type { BunRequest, Server } from "bun";
import { HttpError } from "./http-error";
import type { StandardSchemaV1 } from "./standard-schema";
import {
  createProcedureErrorResult,
  createSystemError,
  isProcedureErrorResult,
  type AnyProcedure,
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
  use<TResult>(
    fn: (
      ctx: TContext & BaseContext & ProcedureHelpers
    ) => MaybePromise<TResult>
  ): ProcedureBuilder<
    TContext &
      NormalizeMiddlewareContext<MiddlewareContextFromResult<TResult>>,
    TError | ProcedureErrorFromResult<TResult>
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
  ctx: BaseContext & ProcedureHelpers & Record<string, unknown>
) =>
  | Promise<Record<string, unknown> | ProcedureErrorResult<AppRpcError>>
  | Record<string, unknown>
  | ProcedureErrorResult<AppRpcError>;

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
  return {
    use<TResult>(
      fn: (
        ctx: TContext & BaseContext & ProcedureHelpers
      ) => MaybePromise<TResult>
    ): ProcedureBuilder<
      TContext &
        NormalizeMiddlewareContext<MiddlewareContextFromResult<TResult>>,
      TError | ProcedureErrorFromResult<TResult>
    > {
      return createProcedureBuilder<
        TContext &
          NormalizeMiddlewareContext<MiddlewareContextFromResult<TResult>>,
        TError | ProcedureErrorFromResult<TResult>
      >([...middlewares, fn as RuntimeMiddleware]);
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
export function createBunRPCRoutes<T extends Router>(
  router: T,
  options: { prefix?: string } = {}
): BunRPCRoutes<T> {
  const { prefix = "/api" } = options;
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
      if (req.method !== "POST") {
        throw new HttpError(405, "Method not allowed, use POST", undefined, {
          code: "METHOD_NOT_ALLOWED",
        });
      }

      const helpers = createProcedureHelpers();
      let ctx: BaseContext & ProcedureHelpers & Record<string, unknown> = {
        req,
        server,
        ...helpers,
      };

      for (const middleware of procedure.middlewares) {
        const middlewareResult = await middleware(ctx);

        if (isProcedureErrorResult(middlewareResult)) {
          return Response.json(middlewareResult.error, {
            status: middlewareResult.error.status,
          });
        }

        ctx = { ...ctx, ...middlewareResult };
      }

      let input: unknown;
      if (procedure.inputSchema) {
        let rawBody: unknown;
        try {
          rawBody = await req.json();
        } catch {
          throw new HttpError(400, "Invalid JSON body", undefined, {
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
          throw new HttpError(400, "Validation failed", { issues }, {
            code: "VALIDATION_ERROR",
          });
        }
        input = validation.value;
      }

      const handlerResult = await procedure.handler({ ...ctx, input } as never);
      if (isProcedureErrorResult(handlerResult)) {
        return Response.json(handlerResult.error, {
          status: handlerResult.error.status,
        });
      }

      return Response.json(handlerResult);
    };
  }

  return {
    _router: router,
    routes,
  };
}

// ============================================================================
// Wrap helper for error handling and logging
// ============================================================================

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
};

function getStatusColor(status: number): string {
  if (status >= 500) return colors.red;
  if (status >= 400) return colors.yellow;
  return colors.green;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function log(
  method: string,
  path: string,
  status: number,
  duration: number,
  error?: string
) {
  const timestamp = new Date().toISOString().slice(11, 23);
  const statusColor = getStatusColor(status);
  const durationStr = formatDuration(duration);

  const line = [
    `${colors.dim}${timestamp}${colors.reset}`,
    `${colors.cyan}${method.padEnd(6)}${colors.reset}`,
    path,
    `${statusColor}${status}${colors.reset}`,
    `${colors.dim}${durationStr}${colors.reset}`,
  ].join(" ");

  console.log(line);

  if (error) {
    console.log(`${colors.dim}  └─${colors.reset} ${error}`);
  }
}

type RouteHandler = (
  req: BunRequest<string>,
  server: Server<unknown>
) => Promise<Response>;

/**
 * Wrap RPC routes with error handling and logging
 */
export function wrapRoutes(
  routes: Record<string, RouteHandler>
): Record<string, RouteHandler> {
  const wrapped: Record<string, RouteHandler> = {};

  for (const [path, handler] of Object.entries(routes)) {
    wrapped[path] = async (
      req: BunRequest<string>,
      server: Server<unknown>
    ) => {
      const url = new URL(req.url);
      const start = Date.now();

      try {
        const result = await handler(req, server);
        log(req.method, url.pathname, result.status, Date.now() - start);
        return result;
      } catch (error) {
        const duration = Date.now() - start;

        if (error instanceof HttpError) {
          log(
            req.method,
            url.pathname,
            error.status,
            duration,
            error.formatForLog()
          );
          if (error.status >= 500) {
            console.error(error.stack);
          }
          return Response.json(error.toJSON(), { status: error.status });
        }

        log(req.method, url.pathname, 500, duration, String(error));
        console.error(error);

        const payload = createSystemError(
          "INTERNAL_SERVER_ERROR",
          500,
          "Internal Server Error"
        );

        return Response.json(payload, { status: 500 });
      }
    };
  }

  return wrapped;
}
