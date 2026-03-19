import type {
  BaseContext,
  BunRPCPlugin,
  BunRPCPluginProcedureInfo,
  BunRPCPluginSetupContext,
  BunRPCRouteHandler,
  StandardSchemaV1,
} from "@bunrpc/core";
import {
  createOAuthProtectedResourceMetadata,
  getOAuthProtectedResourceMetadataPath,
} from "./auth";
import { extractObjectJSONSchema } from "./json-schema";
import type {
  JSONSchemaObject,
  MCPAuthOptions,
  MCPHandlerContext,
  MCPHeaderAuthOptions,
  MCPOAuthAuthOptions,
  MCPPluginExtension,
  MCPPluginOptions,
  MCPProcedureMeta,
  MCPQueryAuthOptions,
  MCPRequestContext,
  MCPResolvedTool,
  MCPToolOptions,
} from "./mcp-types";
import { createMCPRouteHandler } from "./runtime";

const DEFAULT_PATH = "/mcp";
const DEFAULT_SERVER_NAME = "bunrpc-mcp";
const DEFAULT_SERVER_VERSION = "1.0.0";

export interface MCPProcedureMethods {
  tool: (options?: string | MCPToolOptions) => Pick<MCPProcedureMeta, "tool">;
}

export interface MCPProcedureHandlerMethods {
  mcpOnlyHandler: Pick<MCPProcedureMeta, "mcpOnly"> & {
    __httpExposed: false;
  };
}

export type {
  MCPAuthContext,
  MCPAuthOptions,
  MCPHandlerContext,
  MCPHeaderAuthOptions,
  MCPOAuthAuthOptions,
  MCPPluginExtension,
  MCPPluginOptions,
  MCPProcedureMeta,
  MCPQueryAuthOptions,
  MCPRequestContext,
  MCPServerInfo,
  MCPToolIcon,
  MCPToolOptions,
} from "./mcp-types";

export function isMcpRequestContext<
  TContext extends BaseContext & { mcp?: unknown },
>(ctx: TContext): ctx is MCPRequestContext<TContext> {
  return ctx.requestSource === "mcp" && ctx.mcp !== undefined;
}

function normalizeToolOptions(
  options?: string | MCPToolOptions
): MCPToolOptions {
  if (typeof options === "string") {
    return {
      name: options,
    };
  }

  return options ?? {};
}

function isToolProcedure(
  procedure: BunRPCPluginProcedureInfo<MCPProcedureMeta>
): procedure is BunRPCPluginProcedureInfo<MCPProcedureMeta> & {
  meta: {
    tool: MCPToolOptions;
  };
  inputSchema: StandardSchemaV1;
  outputSchema: StandardSchemaV1;
} {
  return procedure.meta?.tool !== undefined;
}

function toSnakeCaseSegment(value: string): string {
  return value
    .replace(/([A-Z]+)([A-Z][a-z0-9])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s.-]+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

function createToolName(path: string, options: MCPToolOptions): string {
  if (options.name) {
    return options.name;
  }

  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => toSnakeCaseSegment(segment))
    .join("_");
}

function resolveToolSchema(
  schema: StandardSchemaV1 | undefined,
  mode: "input" | "output",
  procedurePath: string
): JSONSchemaObject {
  return extractObjectJSONSchema(schema, mode, procedurePath);
}

function resolveTool(
  procedure: BunRPCPluginProcedureInfo<MCPProcedureMeta>
): MCPResolvedTool {
  if (!isToolProcedure(procedure)) {
    throw new Error("Expected MCP tool procedure metadata");
  }

  if (!procedure.inputSchema) {
    throw new Error(
      `MCP tool "${procedure.path}" must define .input(schema) before .handler(...)`
    );
  }

  if (!procedure.outputSchema) {
    throw new Error(
      `MCP tool "${procedure.path}" must define .output(schema) before .handler(...)`
    );
  }

  const toolOptions = procedure.meta.tool;

  return {
    name: createToolName(procedure.path, toolOptions),
    title: toolOptions.title,
    description: toolOptions.description,
    annotations: toolOptions.annotations,
    execution: toolOptions.execution,
    icons: toolOptions.icons,
    _meta: toolOptions._meta,
    path: procedure.path,
    fullPath: procedure.fullPath,
    inputSchema: resolveToolSchema(
      procedure.inputSchema,
      "input",
      procedure.path
    ),
    outputSchema: resolveToolSchema(
      procedure.outputSchema,
      "output",
      procedure.path
    ),
    procedureInfo: procedure,
  };
}

function resolveTools(
  procedures: BunRPCPluginProcedureInfo<MCPProcedureMeta>[]
): MCPResolvedTool[] {
  for (const procedure of procedures) {
    if (procedure.meta?.mcpOnly && !procedure.meta.tool) {
      throw new Error(
        `MCP-only procedure "${procedure.path}" must define .tool(...) before .mcpOnlyHandler(...)`
      );
    }
  }

  const tools = procedures.filter(isToolProcedure).map(resolveTool);
  const seenNames = new Set<string>();

  for (const tool of tools) {
    if (seenNames.has(tool.name)) {
      throw new Error(`Duplicate MCP tool name "${tool.name}"`);
    }

    seenNames.add(tool.name);
  }

  return tools;
}

export function mcp(): BunRPCPlugin<
  "mcp",
  MCPPluginOptions<undefined>,
  MCPProcedureMethods,
  MCPProcedureMeta,
  MCPPluginExtension,
  {
    mcp?: MCPHandlerContext<undefined>;
  },
  "mcp",
  MCPProcedureHandlerMethods
>;

export function mcp<THeaderData extends Record<string, unknown>>(
  options: MCPPluginOptions<MCPHeaderAuthOptions<THeaderData>>
): BunRPCPlugin<
  "mcp",
  MCPPluginOptions<MCPHeaderAuthOptions<THeaderData>>,
  MCPProcedureMethods,
  MCPProcedureMeta,
  MCPPluginExtension,
  {
    mcp?: MCPHandlerContext<MCPHeaderAuthOptions<THeaderData>>;
  },
  "mcp",
  MCPProcedureHandlerMethods
>;

export function mcp<TQueryData extends Record<string, unknown>>(
  options: MCPPluginOptions<MCPQueryAuthOptions<TQueryData>>
): BunRPCPlugin<
  "mcp",
  MCPPluginOptions<MCPQueryAuthOptions<TQueryData>>,
  MCPProcedureMethods,
  MCPProcedureMeta,
  MCPPluginExtension,
  {
    mcp?: MCPHandlerContext<MCPQueryAuthOptions<TQueryData>>;
  },
  "mcp",
  MCPProcedureHandlerMethods
>;

export function mcp(
  options: MCPPluginOptions<MCPOAuthAuthOptions>
): BunRPCPlugin<
  "mcp",
  MCPPluginOptions<MCPOAuthAuthOptions>,
  MCPProcedureMethods,
  MCPProcedureMeta,
  MCPPluginExtension,
  {
    mcp?: MCPHandlerContext<MCPOAuthAuthOptions>;
  },
  "mcp",
  MCPProcedureHandlerMethods
>;

export function mcp(
  options: MCPPluginOptions<MCPAuthOptions | undefined> = {}
): any {
  return {
    name: "mcp",
    options,
    methods: {
      tool: (toolOptions: string | MCPToolOptions | undefined) => ({
        tool: normalizeToolOptions(toolOptions),
      }),
    },
    handlerMethods: {
      mcpOnlyHandler: {
        mcpOnly: true,
        __httpExposed: false,
      },
    },
    setup: ({
      options: pluginOptions,
      procedures,
      invokeProcedure,
    }: BunRPCPluginSetupContext<
      MCPProcedureMeta,
      MCPPluginOptions<MCPAuthOptions | undefined>
    >) => {
      const path = pluginOptions.path ?? DEFAULT_PATH;
      const instructions = pluginOptions.instructions;
      const tools = resolveTools(procedures);
      const serverInfo = {
        name: pluginOptions.server?.name ?? DEFAULT_SERVER_NAME,
        version: pluginOptions.server?.version ?? DEFAULT_SERVER_VERSION,
      };
      const enableJsonResponse =
        pluginOptions.transport?.enableJsonResponse ?? true;
      const sessionIdGenerator =
        pluginOptions.transport?.sessionIdGenerator ??
        (() => crypto.randomUUID());
      const routes: Record<string, BunRPCRouteHandler> = {};

      routes[path] = createMCPRouteHandler({
        path,
        serverInfo,
        instructions,
        auth: pluginOptions.auth,
        enableJsonResponse,
        sessionIdGenerator,
        tools,
        invokeProcedure,
      });

      if (pluginOptions.auth?.type === "oauth") {
        const oauthAuth = pluginOptions.auth as MCPOAuthAuthOptions;
        const protectedResourceMetadataPath =
          getOAuthProtectedResourceMetadataPath(path);

        routes[protectedResourceMetadataPath] = (req) => {
          if (req.method !== "GET") {
            return new Response("Method Not Allowed", {
              status: 405,
            });
          }

          return Response.json(
            createOAuthProtectedResourceMetadata(req, path, oauthAuth)
          );
        };
      }

      return {
        extension: {
          path,
          instructions,
          tools: tools.map((tool) => ({
            name: tool.name,
            title: tool.title,
            description: tool.description,
            path: tool.fullPath,
          })),
          ...(pluginOptions.auth === undefined
            ? {}
            : {
                auth: {
                  type: pluginOptions.auth.type,
                  ...(pluginOptions.auth.type === "oauth"
                    ? {
                        protectedResourceMetadataPath:
                          getOAuthProtectedResourceMetadataPath(path),
                      }
                    : {}),
                },
              }),
        },
        routes,
      };
    },
  };
}
