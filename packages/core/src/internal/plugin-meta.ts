import type {
  AnyBunRPCPlugin,
  PluginProcedureMeta,
  ProcedurePluginEntry,
} from "../plugin-types";
import type { AnyProcedure } from "../procedure-types";

const RESERVED_PROCEDURE_METHOD_NAMES = new Set([
  "use",
  "input",
  "output",
  "handler",
]);

const procedurePluginMetaStore = new WeakMap<
  AnyProcedure,
  Map<string, unknown>
>();

export function isProcedureMetaPatch(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveHandlerMethodPatch(patch: Record<string, unknown>): {
  metaPatch: Record<string, unknown>;
  httpExposed: boolean;
} {
  const { __httpExposed, ...metaPatch } = patch;

  return {
    metaPatch,
    httpExposed: typeof __httpExposed === "boolean" ? __httpExposed : true,
  };
}

export function assertPluginCompatibility(
  plugins: readonly AnyBunRPCPlugin[],
  plugin: AnyBunRPCPlugin
): void {
  if (plugins.some((entry) => entry.name === plugin.name)) {
    throw new Error(`bunrpc plugin "${plugin.name}" is already registered`);
  }

  const pluginMethodNames = Object.keys(plugin.methods ?? {});
  const pluginHandlerMethodNames = Object.keys(plugin.handlerMethods ?? {});
  const methodNames = [...pluginMethodNames, ...pluginHandlerMethodNames];
  const seenMethodNames = new Set<string>();

  for (const methodName of methodNames) {
    if (seenMethodNames.has(methodName)) {
      throw new Error(
        `Procedure plugin method "${methodName}" is defined multiple times in "${plugin.name}"`
      );
    }

    seenMethodNames.add(methodName);

    if (RESERVED_PROCEDURE_METHOD_NAMES.has(methodName)) {
      throw new Error(
        `Procedure plugin method "${methodName}" from "${plugin.name}" conflicts with a built-in builder method`
      );
    }

    for (const existingPlugin of plugins) {
      const existingMethod =
        (existingPlugin.methods as Record<string, unknown> | undefined)?.[
          methodName
        ] ??
        (
          existingPlugin.handlerMethods as Record<string, unknown> | undefined
        )?.[methodName];

      if (existingMethod) {
        throw new Error(
          `Procedure plugin method "${methodName}" is defined by both "${existingPlugin.name}" and "${plugin.name}"`
        );
      }
    }
  }
}

export function setProcedurePluginMeta(
  procedure: AnyProcedure,
  entries: readonly ProcedurePluginEntry[]
): void {
  if (entries.length === 0) {
    return;
  }

  const metaByPluginName = new Map<string, unknown>();

  for (const entry of entries) {
    metaByPluginName.set(entry.name, entry.meta);
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

export function mergeProcedurePluginMeta(
  entries: readonly ProcedurePluginEntry[],
  pluginName: string,
  patch: Record<string, unknown>
): readonly ProcedurePluginEntry[] {
  const existingIndex = entries.findIndex((entry) => entry.name === pluginName);

  if (existingIndex === -1) {
    return [
      ...entries,
      {
        name: pluginName,
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
    name: pluginName,
    meta: {
      ...(existingEntry.meta as Record<string, unknown>),
      ...patch,
    },
  };

  return nextEntries;
}
