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
import type { BunRequest } from "bun";

export interface MCPToolIcon {
  mimeType?: string;
  sizes?: string[];
  src: string;
  theme?: "light" | "dark";
}

export interface MCPToolOptions {
  _meta?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  description?: string;
  execution?: ToolExecution;
  icons?: MCPToolIcon[];
  name?: string;
  title?: string;
}

export interface MCPProcedureMeta {
  mcpOnly?: true;
  tool?: MCPToolOptions;
}

export interface MCPOAuthAuthOptions {
  metadata?: Omit<OAuthProtectedResourceMetadata, "resource">;
  requiredScopes?: string[];
  type: "oauth";
  verifyAccessToken: (
    token: string,
    req: BunRequest<string>
  ) => MaybePromise<AuthInfo | null | undefined>;
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

export type ResolvedMCPAuthContext<TAuth extends MCPAuthOptions | undefined> = [
  TAuth,
] extends [undefined]
  ? never
  : TAuth extends MCPAuthOptions
    ? MCPAuthContext<TAuth>
    : never;

export interface MCPHandlerContext<
  TAuth extends MCPAuthOptions | undefined = MCPAuthOptions | undefined,
> {
  auth?: ResolvedMCPAuthContext<TAuth>;
  sessionId?: string;
  toolName: string;
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
  auth?: TAuth;
  instructions?: string;
  path?: string;
  server?: MCPServerInfo;
  transport?: MCPTransportOptions;
}

export interface MCPPluginExtension {
  auth?: {
    type: MCPAuthOptions["type"];
    protectedResourceMetadataPath?: string;
  };
  instructions?: string;
  path: string;
  tools: Array<Pick<Tool, "name" | "title" | "description"> & { path: string }>;
}

export interface JSONSchemaObject extends Record<string, unknown> {
  properties?: Record<string, object>;
  required?: string[];
  type: "object";
}

export interface MCPResolvedTool {
  _meta?: Record<string, unknown>;
  annotations?: ToolAnnotations;
  description?: string;
  execution?: ToolExecution;
  fullPath: string;
  icons?: MCPToolIcon[];
  inputSchema: JSONSchemaObject;
  name: string;
  outputSchema: JSONSchemaObject;
  path: string;
  procedureInfo: BunRPCPluginProcedureInfo<MCPProcedureMeta>;
  title?: string;
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
