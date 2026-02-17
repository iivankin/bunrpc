import type { BunRequest, Server } from "bun";
import { HttpError } from "./http-error";
import type {
  AnyProcedure,
  BaseContext,
  BunRPCRoutes,
  InferSchemaOutput,
  Procedure,
  Router,
} from "./types";
import type { StandardSchemaV1 } from "./standard-schema";

// ============================================================================
// Middleware Builder
// ============================================================================

type MiddlewareFn<TContextIn, TContextOut> = (
  ctx: TContextIn & BaseContext
) => Promise<TContextOut> | TContextOut;

interface ProcedureBuilder<TContext> {
  /**
   * Add middleware that extends context
   */
  use<TNewContext extends Record<string, unknown>>(
    fn: MiddlewareFn<TContext, TNewContext>
  ): ProcedureBuilder<TContext & TNewContext>;

  /**
   * Define input schema
   */
  input<TSchema extends StandardSchemaV1>(
    schema: TSchema
  ): ProcedureBuilderWithInput<TContext, InferSchemaOutput<TSchema>>;

  /**
   * Define handler without input
   */
  handler<TOutput>(
    fn: (
      ctx: TContext & BaseContext & { input: undefined }
    ) => Promise<TOutput> | TOutput
  ): Procedure<TContext & BaseContext, undefined, TOutput>;
}

interface ProcedureBuilderWithInput<TContext, TInput> {
  /**
   * Define handler with input
   */
  handler<TOutput>(
    fn: (
      ctx: TContext & BaseContext & { input: TInput }
    ) => Promise<TOutput> | TOutput
  ): Procedure<TContext & BaseContext, TInput, TOutput>;
}

/**
 * Create a procedure builder with middleware chain
 *
 * @example
 * ```ts
 * const publicProcedure = createProcedure();
 *
 * const authProcedure = publicProcedure.use(async ({ req }) => {
 *   const session = await getSession(req);
 *   return { session, user: session.user };
 * });
 *
 * const adminProcedure = authProcedure.use(async ({ user }) => {
 *   if (!user.isAdmin) throw new HttpError(403, "Admin only");
 *   return {};
 * });
 * ```
 */
export function createProcedure(): ProcedureBuilder<Record<string, never>> {
  return createProcedureBuilder([]);
}

function createProcedureBuilder<TContext>(
  middlewares: Array<(ctx: BaseContext) => Promise<Record<string, unknown>>>
): ProcedureBuilder<TContext> {
  return {
    use<TNewContext extends Record<string, unknown>>(
      fn: MiddlewareFn<TContext, TNewContext>
    ): ProcedureBuilder<TContext & TNewContext> {
      return createProcedureBuilder([
        ...middlewares,
        fn as (ctx: BaseContext) => Promise<Record<string, unknown>>,
      ]);
    },

    input<TSchema extends StandardSchemaV1>(
      schema: TSchema
    ): ProcedureBuilderWithInput<TContext, InferSchemaOutput<TSchema>> {
      return {
        handler<TOutput>(
          fn: (
            ctx: TContext & BaseContext & { input: InferSchemaOutput<TSchema> }
          ) => Promise<TOutput> | TOutput
        ): Procedure<
          TContext & BaseContext,
          InferSchemaOutput<TSchema>,
          TOutput
        > {
          return {
            _type: "procedure",
            inputSchema: schema,
            middlewares,
            handler: fn as Procedure<
              TContext & BaseContext,
              InferSchemaOutput<TSchema>,
              TOutput
            >["handler"],
            _ctx: {} as TContext & BaseContext,
            _input: {} as InferSchemaOutput<TSchema>,
            _output: {} as TOutput,
          };
        },
      };
    },

    handler<TOutput>(
      fn: (
        ctx: TContext & BaseContext & { input: undefined }
      ) => Promise<TOutput> | TOutput
    ): Procedure<TContext & BaseContext, undefined, TOutput> {
      return {
        _type: "procedure",
        middlewares,
        handler: fn as Procedure<
          TContext & BaseContext,
          undefined,
          TOutput
        >["handler"],
        _ctx: {} as TContext & BaseContext,
        _input: undefined as undefined,
        _output: {} as TOutput,
      };
    },
  };
}

// ============================================================================
// Router
// ============================================================================

/**
 * Create a router from procedures
 *
 * @example
 * ```ts
 * export const chat = createRouter({
 *   create: authProcedure.input(CreateChatSchema).handler(...),
 *   get: publicProcedure.handler(...),
 *   delete: authProcedure.handler(...),
 * });
 * ```
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
 *
 * @example
 * ```ts
 * const rpcRoutes = createBunRPCRoutes({ chat, user, plan }, { prefix: "/api" });
 *
 * Bun.serve({
 *   routes: {
 *     "/*": index,
 *     ...rpcRoutes.routes,
 *   },
 * });
 *
 * export type AppRouter = typeof rpcRoutes._router;
 * ```
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
      // All RPC calls are POST
      if (req.method !== "POST") {
        throw new HttpError(405, "Method not allowed, use POST");
      }

      // Build context through middleware chain
      let ctx: Record<string, unknown> = { req, server };

      for (const middleware of procedure.middlewares) {
        const result = await middleware(ctx as unknown as BaseContext);
        ctx = { ...ctx, ...result };
      }

      // Parse and validate input
      let input: unknown;
      if (procedure.inputSchema) {
        let rawBody: unknown;
        try {
          rawBody = await req.json();
        } catch {
          throw new HttpError(400, "Invalid JSON body");
        }

        const validation = await procedure.inputSchema["~standard"].validate(
          rawBody
        );
        if (validation.issues) {
          const issues = validation.issues.map((issue) => ({
            path: formatIssuePath(issue.path),
            message: issue.message,
          }));
          throw new HttpError(400, "Validation failed", issues);
        }
        input = validation.value;
      }

      // Call handler
      const result = await procedure.handler({ ...ctx, input } as never);

      return Response.json(result);
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
        return Response.json(
          { error: "Internal Server Error" },
          { status: 500 }
        );
      }
    };
  }

  return wrapped;
}
