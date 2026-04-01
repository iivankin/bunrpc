import type { BunRequest, Server } from "bun";
import { BunRpcHttpError } from "../bunrpc-http-error";
import type {
  BunRPCRouteErrorEvent,
  InitBunRpcOptions,
} from "../server-shared";
import {
  type AnyProcedure,
  type BaseContext,
  BUNRPC_RAW_RESPONSE_HEADER,
  createAppError,
  createProcedureErrorResult,
  createSystemError,
  isProcedureErrorResult,
  type ProcedureErrorFactory,
  type ProcedureHelpers,
  type ProcedureNextResult,
  type ProcedureNextResultOrResponse,
  type RpcResult,
  type SystemRpcErrorCode,
} from "../types";
import {
  NO_INPUT_OVERRIDE,
  type ProcedureInputOverride,
} from "./procedure-builder";

const SYSTEM_RPC_ERROR_CODES = new Set<SystemRpcErrorCode>([
  "METHOD_NOT_ALLOWED",
  "INVALID_JSON",
  "VALIDATION_ERROR",
  "HTTP_ERROR",
  "INTERNAL_SERVER_ERROR",
]);

interface ExecuteProcedureOptions {
  context?: Record<string, unknown>;
  formatInternalServerError?: InitBunRpcOptions["formatInternalServerError"];
  fullPath: string;
  inputOverride?: ProcedureInputOverride;
  procedure: AnyProcedure;
  req: BunRequest<string>;
  requestSource?: string;
  server: Server<unknown>;
}

type ExecuteProcedureResult = RpcResult<unknown> | Response;

function isSystemRpcErrorCode(value: string): value is SystemRpcErrorCode {
  return SYSTEM_RPC_ERROR_CODES.has(value as SystemRpcErrorCode);
}

function createProcedureHelpers(): ProcedureHelpers {
  const error: ProcedureErrorFactory = (input) =>
    createProcedureErrorResult(input);
  return { error };
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

function isRawResponse(value: unknown): value is Response {
  return value instanceof Response;
}

export function markRawResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(BUNRPC_RAW_RESPONSE_HEADER, "raw");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function executeProcedure({
  procedure,
  fullPath,
  req,
  server,
  formatInternalServerError,
  inputOverride = NO_INPUT_OVERRIDE,
  requestSource = "rpc",
  context,
}: ExecuteProcedureOptions): Promise<ExecuteProcedureResult> {
  const startedAt = Date.now();
  const url = new URL(req.url);

  try {
    const helpers = createProcedureHelpers();
    const {
      req: _ignoredReq,
      server: _ignoredServer,
      requestSource: _ignoredRequestSource,
      ...contextExtension
    } = context ?? {};
    const baseContext: BaseContext &
      ProcedureHelpers &
      Record<string, unknown> = {
      req,
      server,
      requestSource,
      ...helpers,
      ...contextExtension,
    };

    const run = async (
      middlewareIndex: number,
      contextValue: BaseContext & ProcedureHelpers & Record<string, unknown>
    ): Promise<ProcedureNextResultOrResponse> => {
      if (middlewareIndex >= procedure.middlewares.length) {
        let input: unknown;
        if (procedure.inputSchema) {
          let rawInput: unknown;
          if (inputOverride === NO_INPUT_OVERRIDE) {
            try {
              rawInput = await req.json();
            } catch {
              throw new BunRpcHttpError(400, "Invalid JSON body", undefined, {
                code: "INVALID_JSON",
              });
            }
          } else {
            rawInput = inputOverride;
          }

          const validation =
            await procedure.inputSchema["~standard"].validate(rawInput);
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
          ...contextValue,
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

      const middleware = procedure.middlewares[middlewareIndex];
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
        ...contextValue,
        path: fullPath,
        type: "rpc",
        next: <TContextExtension extends Record<string, unknown>>(
          nextContext?: TContextExtension
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

          return run(middlewareIndex + 1, {
            ...contextValue,
            ...(nextContext ?? {}),
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

    return await run(0, baseContext);
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
      duration: Date.now() - startedAt,
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
