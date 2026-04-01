import type { BunRequest, Server } from "bun";
import type { InitBunRpcOptions } from "../server-shared";
import {
  type AnyBunRPCPlugin,
  type AnyProcedure,
  type BunRPCRouteHandler,
  type BunRPCRoutes,
  createSystemError,
  type Router,
  type RouterPluginExtensions,
} from "../types";
import { getProcedurePluginMeta } from "./plugin-meta";
import { executeProcedure, markRawResponse } from "./procedure-execution";
import { isProcedure } from "./router-metadata";

function collectProcedures(
  router: Router,
  currentPath = ""
): Array<{ path: string; procedure: AnyProcedure }> {
  const procedures: Array<{ path: string; procedure: AnyProcedure }> = [];

  for (const [key, value] of Object.entries(router)) {
    const path = currentPath ? `${currentPath}/${key}` : key;

    if (isProcedure(value)) {
      procedures.push({ path, procedure: value });
    } else if (typeof value === "object" && value !== null) {
      procedures.push(...collectProcedures(value as Router, path));
    }
  }

  return procedures;
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
      const fullPath = `${prefix}/${path}`;

      return {
        path,
        fullPath,
        procedure,
        httpExposed:
          procedure._httpExposed !== false &&
          plugins.every((plugin) => {
            if (!plugin.includeProcedureInHttpRoutes) {
              return true;
            }

            return plugin.includeProcedureInHttpRoutes({
              path,
              fullPath,
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

        if (result instanceof Response) {
          return markRawResponse(result);
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
