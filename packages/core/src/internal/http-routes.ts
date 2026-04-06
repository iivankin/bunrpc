import type { BunRequest, Server } from "bun";
import type { InitBunRpcOptions } from "../server-shared";
import {
  type AnyBunRPCPlugin,
  type BunRPCRouteHandler,
  type BunRPCRoutes,
  createSystemError,
  type Router,
  type RouterPluginExtensions,
} from "../types";
import { getProcedurePluginMeta } from "./plugin-meta";
import { executeProcedure, markRawResponse } from "./procedure-execution";
import {
  collectProcedures,
  resolveProcedureHttpRoute,
} from "./procedure-routing";

interface RegisteredRouteEntry {
  methodHandlers: Map<
    string,
    {
      handler: BunRPCRouteHandler;
      source: string;
    }
  >;
  pathHandler?: {
    handler: BunRPCRouteHandler;
    source: string;
  };
}

function createMethodNotAllowedResponse(entry: RegisteredRouteEntry): Response {
  const allowedMethods = [...entry.methodHandlers.keys()].sort();
  const allowedMethodsLabel =
    allowedMethods.length > 0 ? allowedMethods.join(", ") : "none";
  const error = createSystemError(
    "METHOD_NOT_ALLOWED",
    405,
    `Method not allowed, allowed methods: ${allowedMethodsLabel}`
  );

  return Response.json(error, {
    status: error.status,
    headers:
      allowedMethods.length > 0
        ? {
            Allow: allowedMethods.join(", "),
          }
        : undefined,
  });
}

function registerRoute(
  routes: Record<
    string,
    (req: BunRequest<string>, server: Server<unknown>) => Promise<Response>
  >,
  registeredRoutes: Map<string, RegisteredRouteEntry>,
  path: string,
  handler: BunRPCRouteHandler,
  source: string,
  method?: string
): void {
  let entry = registeredRoutes.get(path);

  if (!entry) {
    entry = {
      methodHandlers: new Map(),
    };
    registeredRoutes.set(path, entry);
    routes[path] = (req: BunRequest<string>, server: Server<unknown>) => {
      if (entry?.pathHandler) {
        return Promise.resolve(entry.pathHandler.handler(req, server));
      }

      const methodHandler = entry?.methodHandlers.get(req.method.toUpperCase());
      if (methodHandler) {
        return Promise.resolve(methodHandler.handler(req, server));
      }

      return Promise.resolve(
        createMethodNotAllowedResponse(
          entry ?? {
            methodHandlers: new Map(),
          }
        )
      );
    };
  }

  if (method === undefined) {
    if (entry.pathHandler || entry.methodHandlers.size > 0) {
      throw new Error(`Route "${path}" is already registered (${source})`);
    }

    entry.pathHandler = {
      handler,
      source,
    };
    return;
  }

  if (entry.pathHandler) {
    throw new Error(`Route "${path}" is already registered (${source})`);
  }

  if (entry.methodHandlers.has(method)) {
    throw new Error(
      `Route "${method} ${path}" is already registered (${source})`
    );
  }

  entry.methodHandlers.set(method, {
    handler,
    source,
  });
}

export function buildHttpRoutes<
  TRouter extends Router,
  TPlugins extends readonly AnyBunRPCPlugin[],
>(
  router: TRouter,
  plugins: TPlugins,
  options: InitBunRpcOptions = {}
): BunRPCRoutes<TRouter, RouterPluginExtensions<TPlugins>> {
  const { prefix = "/api", formatInternalServerError } = options;
  const procedureInfos = collectProcedures(router).map(
    ({ path, procedure }) => {
      const resolvedRoute = resolveProcedureHttpRoute(prefix, path, procedure);

      return {
        ...resolvedRoute,
        procedure,
        httpExposed:
          procedure._httpExposed !== false &&
          plugins.every((plugin) => {
            if (!plugin.includeProcedureInHttpRoutes) {
              return true;
            }

            return plugin.includeProcedureInHttpRoutes({
              path,
              fullPath: resolvedRoute.fullPath,
              httpMethod: resolvedRoute.httpMethod,
              procedure,
              httpExposed: true,
              inputSchema: procedure.inputSchema,
              outputSchema: procedure.outputSchema,
              meta: getProcedurePluginMeta(procedure, plugin as never),
            });
          }),
        inputSchema: procedure.inputSchema,
        outputSchema: procedure.outputSchema,
      };
    }
  );
  const routes: Record<
    string,
    (req: BunRequest<string>, server: Server<unknown>) => Promise<Response>
  > = {};
  const registeredRoutes = new Map<string, RegisteredRouteEntry>();

  for (const procedureInfo of procedureInfos) {
    if (!procedureInfo.httpExposed) {
      continue;
    }

    registerRoute(
      routes,
      registeredRoutes,
      procedureInfo.fullPath,
      async (req: BunRequest<string>, server: Server<unknown>) => {
        if (req.method.toUpperCase() !== procedureInfo.httpMethod) {
          const error = createSystemError(
            "METHOD_NOT_ALLOWED",
            405,
            `Method not allowed, use ${procedureInfo.httpMethod}`
          );
          return Response.json(error, {
            status: error.status,
            headers: {
              Allow: procedureInfo.httpMethod,
            },
          });
        }

        const result = await executeProcedure({
          procedure: procedureInfo.procedure,
          fullPath: procedureInfo.fullPath,
          req,
          server,
          formatInternalServerError,
        });

        if (result instanceof Response) {
          return markRawResponse(result);
        }

        if (!result.ok) {
          return Response.json(result.error, { status: result.error.status });
        }

        return Response.json(result.data);
      },
      `rpc procedure ${procedureInfo.httpMethod} ${procedureInfo.fullPath}`,
      procedureInfo.httpMethod
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
        registerRoute(
          routes,
          registeredRoutes,
          path,
          handler,
          `plugin ${plugin.name}`
        );
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
