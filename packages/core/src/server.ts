import { buildHttpRoutes } from "./internal/http-routes";
import { assertPluginCompatibility } from "./internal/plugin-meta";
import type {
  AppBaseContext,
  ProcedureBuilder,
} from "./internal/procedure-builder";
import { createProcedureBuilder } from "./internal/procedure-builder";
import {
  assertRouterCompatibility,
  createRouterFactory,
  getRouterRuntimeMetadata,
} from "./internal/router-metadata";
import type { BunRPCRoutes } from "./plugin-types";
import type { InitBunRpcOptions } from "./server-shared";
import type { AnyBunRPCPlugin, Router, RouterPluginExtensions } from "./types";

export type { BunRPCRouteErrorEvent, InitBunRpcOptions } from "./server-shared";

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

  return {
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
