import type { BunRequest, Server as BunServer } from "bun";
import type { BunRPCPluginSetupContext } from "@bunrpc/core";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  isInitializeRequest,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { authenticateMCPRequest } from "./auth";
import { isJSONObject } from "./json-schema";
import type {
  MCPPluginOptions,
  MCPProcedureMeta,
  MCPResolvedTool,
  ResolvedMCPAuthContext,
} from "./mcp-types";

interface CreateMCPRouteHandlerOptions<
  TOptions extends MCPPluginOptions = MCPPluginOptions,
> {
  path: string;
  serverInfo: {
    name: string;
    version: string;
  };
  instructions?: string;
  auth: TOptions["auth"];
  enableJsonResponse: boolean;
  sessionIdGenerator: () => string;
  tools: MCPResolvedTool[];
  invokeProcedure: BunRPCPluginSetupContext<
    MCPProcedureMeta,
    TOptions
  >["invokeProcedure"];
}

function createTextContent(text: string): CallToolResult["content"] {
  return [
    {
      type: "text",
      text,
    },
  ];
}

function createToolErrorResult(
  message: string,
  error?: unknown
): CallToolResult {
  return {
    isError: true,
    content: createTextContent(message),
    ...(error === undefined
      ? {}
      : {
          _meta: {
            bunrpc: {
              error,
            },
          },
        }),
  };
}

function createToolSuccessResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: createTextContent(JSON.stringify(data, null, 2)),
    structuredContent: data,
  };
}

function toMCPTool(tool: MCPResolvedTool): Tool {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    annotations: tool.annotations,
    execution: tool.execution,
    icons: tool.icons,
    _meta: tool._meta,
  };
}

export function createMCPRouteHandler<
  TOptions extends MCPPluginOptions = MCPPluginOptions,
>({
  path,
  serverInfo,
  instructions,
  auth,
  enableJsonResponse,
  sessionIdGenerator,
  tools,
  invokeProcedure,
}: CreateMCPRouteHandlerOptions<TOptions>) {
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const transports = new Map<
    string,
    WebStandardStreamableHTTPServerTransport
  >();
  let currentReq: BunRequest<string> | undefined;
  let currentServer: BunServer<unknown> | undefined;
  let currentSessionId: string | undefined;
  let currentAuth: ResolvedMCPAuthContext<TOptions["auth"]> | undefined;

  return async (
    req: BunRequest<string>,
    bunServer: BunServer<unknown>
  ): Promise<Response> => {
    if ("timeout" in bunServer && typeof bunServer.timeout === "function") {
      bunServer.timeout(req, 0);
    }

    if (req.method === "GET" && enableJsonResponse) {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: "POST",
        },
      });
    }

    const authResult = await authenticateMCPRequest(req, path, auth);
    if (authResult instanceof Response) {
      return authResult;
    }

    const sessionId = req.headers.get("mcp-session-id");
    const parsedBody =
      req.method === "POST"
        ? await req
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    currentReq = req;
    currentServer = bunServer;
    currentSessionId = sessionId ?? undefined;
    currentAuth = authResult.auth;

    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport) {
      if (sessionId) {
        return new Response("Session not found", {
          status: 404,
        });
      }

      if (req.method !== "POST" || !isInitializeRequest(parsedBody)) {
        return Response.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: "Bad Request: No valid session ID provided",
            },
            id:
              typeof parsedBody === "object" &&
              parsedBody !== null &&
              "id" in parsedBody
                ? parsedBody.id
                : null,
          },
          {
            status: 400,
          }
        );
      }

      const mcpServer = new Server(serverInfo, {
        capabilities: {
          tools: {},
        },
        instructions,
      });

      mcpServer.setRequestHandler(ListToolsRequestSchema, () => ({
        tools: tools.map((tool) => toMCPTool(tool)),
      }));

      mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
        if (!currentReq || !currentServer) {
          return createToolErrorResult("MCP request context is unavailable");
        }

        const tool = toolsByName.get(request.params.name);

        if (!tool) {
          return createToolErrorResult(`Unknown MCP tool "${request.params.name}"`);
        }

        const result = await invokeProcedure(tool.procedureInfo, {
          req: currentReq,
          server: currentServer,
          input: request.params.arguments,
          requestSource: "mcp",
          context: {
            mcp: {
              sessionId: currentSessionId,
              toolName: tool.name,
              auth: currentAuth,
            },
          },
        });

        if (!result.ok) {
          const errorLabel =
            result.error.message ??
            `${result.error.source}:${result.error.code}`;

          return createToolErrorResult(errorLabel, result.error);
        }

        if (!isJSONObject(result.data)) {
          return createToolErrorResult(
            `MCP tool "${tool.name}" must return an object matching .output(schema)`
          );
        }

        return createToolSuccessResult(result.data);
      });

      let initializedTransport!: WebStandardStreamableHTTPServerTransport;
      initializedTransport = new WebStandardStreamableHTTPServerTransport({
        enableJsonResponse,
        sessionIdGenerator,
        onsessioninitialized: (newSessionId) => {
          transports.set(newSessionId, initializedTransport);
        },
        onsessionclosed: (closedSessionId) => {
          transports.delete(closedSessionId);
        },
      });

      await mcpServer.connect(initializedTransport);
      transport = initializedTransport;
    }

    return transport.handleRequest(req, {
      authInfo: authResult.auth?.type === "oauth" ? authResult.auth.data : undefined,
      parsedBody,
    });
  };
}
