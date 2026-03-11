import type {
  AnyBunRPCPlugin,
  AnyProcedure,
  BunRPCPlugin,
  BunRPCPluginDefinition,
  BunRPCPluginProcedureMethods,
  PluginProcedureMeta,
  PluginRouterOptions,
  ProcedurePluginEntry,
  ProcedurePluginUse,
  RouterPluginUse,
} from "./types";

const EMPTY_ROUTER_PLUGINS: readonly RouterPluginUse[] = [];
const PROCEDURE_PLUGIN_USE_TYPE = "procedure-plugin" as const;

const routerPluginStore = new WeakMap<object, readonly RouterPluginUse[]>();
const procedurePluginMetaStore = new WeakMap<
  AnyProcedure,
  Map<string, unknown>
>();

function assertUniquePluginNames(
  scope: string,
  plugins: ReadonlyArray<{ plugin: AnyBunRPCPlugin }>
): void {
  const seen = new Set<string>();

  for (const { plugin } of plugins) {
    if (seen.has(plugin.name)) {
      throw new Error(
        `Duplicate bunrpc plugin "${plugin.name}" registered for ${scope}`
      );
    }

    seen.add(plugin.name);
  }
}

export function definePlugin<
  TName extends string,
  TProcedureMethods extends BunRPCPluginProcedureMethods = {},
  TRouterOptions = undefined,
  TExtension = undefined,
>(
  plugin: BunRPCPluginDefinition<
    TName,
    TProcedureMethods,
    TRouterOptions,
    TExtension
  >
): BunRPCPlugin<TName, TProcedureMethods, TRouterOptions, TExtension> {
  const procedurePlugin = (() => ({
    type: PROCEDURE_PLUGIN_USE_TYPE,
    plugin: procedurePlugin,
  })) as BunRPCPlugin<TName, TProcedureMethods, TRouterOptions, TExtension>;

  Object.defineProperties(procedurePlugin, {
    name: {
      value: plugin.name,
      enumerable: true,
      configurable: true,
    },
    procedure: {
      value: plugin.procedure,
      enumerable: true,
      configurable: true,
    },
    setup: {
      value: plugin.setup,
      enumerable: true,
      configurable: true,
    },
  });

  return procedurePlugin;
}

export function isProcedurePluginUse(
  value: unknown
): value is ProcedurePluginUse<AnyBunRPCPlugin> {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === PROCEDURE_PLUGIN_USE_TYPE &&
    "plugin" in value
  );
}

export function useRouterPlugin<
  TPlugin extends AnyBunRPCPlugin & BunRPCPlugin<any, any, undefined, any>,
>(plugin: TPlugin): RouterPluginUse<TPlugin>;
export function useRouterPlugin<TPlugin extends AnyBunRPCPlugin>(
  plugin: TPlugin,
  options: PluginRouterOptions<TPlugin>
): RouterPluginUse<TPlugin>;
export function useRouterPlugin<TPlugin extends AnyBunRPCPlugin>(
  plugin: TPlugin,
  options?: PluginRouterOptions<TPlugin>
): RouterPluginUse<TPlugin> {
  return {
    plugin,
    options: options as PluginRouterOptions<TPlugin>,
  };
}

export function setRouterPluginUses(
  router: object,
  plugins: readonly RouterPluginUse[]
): void {
  if (plugins.length === 0) {
    return;
  }

  assertUniquePluginNames("router", plugins);
  routerPluginStore.set(router, plugins);
}

export function getRouterPluginUses(router: object): readonly RouterPluginUse[] {
  return routerPluginStore.get(router) ?? EMPTY_ROUTER_PLUGINS;
}

export function setProcedurePluginMeta(
  procedure: AnyProcedure,
  entries: readonly ProcedurePluginEntry[]
): void {
  if (entries.length === 0) {
    return;
  }

  assertUniquePluginNames("procedure", entries);

  const metaByPluginName = new Map<string, unknown>();

  for (const entry of entries) {
    metaByPluginName.set(entry.plugin.name, entry.meta);
  }

  procedurePluginMetaStore.set(procedure, metaByPluginName);
}

export function getProcedurePluginMeta<TPlugin extends AnyBunRPCPlugin>(
  procedure: AnyProcedure,
  plugin: TPlugin
): PluginProcedureMeta<TPlugin> | undefined {
  return procedurePluginMetaStore.get(procedure)?.get(plugin.name) as
    | PluginProcedureMeta<TPlugin>
    | undefined;
}
