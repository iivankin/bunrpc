import type { AnyBunRPCPlugin, Router } from "../plugin-types";
import type { AnyProcedure } from "../procedure-types";
import type { InitBunRpcOptions } from "../server-shared";

interface RouterRuntimeMetadata {
  appId: symbol;
  options: InitBunRpcOptions;
  plugins: readonly AnyBunRPCPlugin[];
}

const routerRuntimeMetadataStore = new WeakMap<Router, RouterRuntimeMetadata>();

function isRouterObject(value: unknown): value is Router {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProcedure(value: unknown): value is AnyProcedure {
  return (
    typeof value === "object" &&
    value !== null &&
    "_type" in value &&
    value._type === "procedure"
  );
}

export function getRouterRuntimeMetadata(
  router: Router
): RouterRuntimeMetadata | undefined {
  return routerRuntimeMetadataStore.get(router);
}

export function assertRouterCompatibility(
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

export function createRouterFactory<
  TPlugins extends readonly AnyBunRPCPlugin[],
>(metadata: { appId: symbol; options: InitBunRpcOptions; plugins: TPlugins }) {
  return function router<TRouter extends Router>(procedures: TRouter): TRouter {
    assertRouterCompatibility(procedures, metadata.appId);
    routerRuntimeMetadataStore.set(procedures, metadata);
    return procedures;
  };
}
