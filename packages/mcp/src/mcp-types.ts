import type { BunRequest } from "bun";
import type {
  BaseContext,
  BunRPCPluginProcedureInfo,
  MaybePromise,
  StandardSchemaV1,
} from "@bunrpc/core";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  Tool,
  ToolAnnotations,
  ToolExecution,
} from "@modelcontextprotocol/sdk/types.js";

export interface MCPToolIcon {
  src: string;
  mimeType?: string;
  sizes?: string[];
  theme?: "light" | "dark";
}

export interface MCPToolOptions {
  name?: string;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  execution?: ToolExecution;
  icons?: MCPToolIcon[];
  _meta?: Record<string, unknown>;
}

export interface MCPProcedureMeta {
  tool?: MCPToolOptions;
  mcpOnly?: true;
}

export interface MCPOAuthAuthOptions {
  type: "oauth";
  verifyAccessToken: (
    token: string,
    req: BunRequest<string>
  ) => MaybePromise<AuthInfo | null | undefined>;
  requiredScopes?: string[];
  metadata?: Omit<OAuthProtectedResourceMetadata, "resource">;
}

export interface MCPHeaderAuthOptions<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  type: "header";
  validate: (
    headers: Headers,
    req: BunRequest<string>
  ) => MaybePromise<TData | false | null | undefined>;
}

export interface MCPQueryAuthOptions<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  type: "query";
  validate: (
    searchParams: URLSearchParams,
    req: BunRequest<string>
  ) => MaybePromise<TData | false | null | undefined>;
}

export type MCPAuthOptions =
  | MCPOAuthAuthOptions
  | MCPHeaderAuthOptions<Record<string, unknown>>
  | MCPQueryAuthOptions<Record<string, unknown>>;

export type MCPAuthContext<TAuth extends MCPAuthOptions = MCPAuthOptions> =
  TAuth extends MCPOAuthAuthOptions
    ? {
        type: "oauth";
        data: AuthInfo;
      }
    : TAuth extends MCPHeaderAuthOptions<infer TData>
      ? {
          type: "header";
          data: TData;
        }
      : TAuth extends MCPQueryAuthOptions<infer TData>
        ? {
            type: "query";
            data: TData;
          }
        : never;

export type ResolvedMCPAuthContext<
  TAuth extends MCPAuthOptions | undefined,
> = [TAuth] extends [undefined]
  ? never
  : TAuth extends MCPAuthOptions
    ? MCPAuthContext<TAuth>
    : never;

export interface MCPHandlerContext<
  TAuth extends MCPAuthOptions | undefined = MCPAuthOptions | undefined,
> {
  sessionId?: string;
  toolName: string;
  auth?: ResolvedMCPAuthContext<TAuth>;
}

export interface MCPServerInfo {
  name?: string;
  version?: string;
}

export interface MCPTransportOptions {
  enableJsonResponse?: boolean;
  sessionIdGenerator?: () => string;
}

export interface MCPPluginOptions<
  TAuth extends MCPAuthOptions | undefined = MCPAuthOptions | undefined,
> {
  path?: string;
  server?: MCPServerInfo;
  instructions?: string;
  auth?: TAuth;
  transport?: MCPTransportOptions;
}

export interface MCPPluginExtension {
  path: string;
  instructions?: string;
  tools: Array<Pick<Tool, "name" | "title" | "description"> & { path: string }>;
  auth?: {
    type: MCPAuthOptions["type"];
    protectedResourceMetadataPath?: string;
  };
}

export interface JSONSchemaObject extends Record<string, unknown> {
  type: "object";
  properties?: Record<string, object>;
  required?: string[];
}

export interface MCPResolvedTool {
  name: string;
  title?: string;
  description?: string;
  annotations?: ToolAnnotations;
  execution?: ToolExecution;
  icons?: MCPToolIcon[];
  _meta?: Record<string, unknown>;
  path: string;
  fullPath: string;
  inputSchema: JSONSchemaObject;
  outputSchema: JSONSchemaObject;
  procedureInfo: BunRPCPluginProcedureInfo<MCPProcedureMeta>;
}

export interface StandardSchemaWithJSONSchema extends StandardSchemaV1 {
  "~standard": StandardSchemaV1["~standard"] & {
    jsonSchema?: {
      input?: () => unknown;
      output?: () => unknown;
    };
  };
  toJSONSchema?: () => unknown;
}

export type MCPRequestContext<
  TContext extends BaseContext & { mcp?: unknown } = BaseContext & {
    mcp?: MCPHandlerContext;
  },
> = TContext & {
  requestSource: "mcp";
  mcp: Exclude<TContext["mcp"], undefined>;
};
