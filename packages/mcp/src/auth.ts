import type { BunRequest } from "bun";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthProtectedResourceMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  MCPAuthOptions,
  MCPHeaderAuthOptions,
  MCPOAuthAuthOptions,
  MCPQueryAuthOptions,
  ResolvedMCPAuthContext,
} from "./mcp-types";

function createUnauthorizedResponse(
  message: string,
  init?: ResponseInit
): Response {
  return new Response(message, {
    status: 401,
    ...init,
  });
}

function createForbiddenResponse(
  message: string,
  init?: ResponseInit
): Response {
  return new Response(message, {
    status: 403,
    ...init,
  });
}

function getOrigin(req: BunRequest<string>): URL {
  return new URL(req.url);
}

export function getOAuthProtectedResourceMetadataPath(path: string): string {
  return `/.well-known/oauth-protected-resource${path === "/" ? "" : path}`;
}

export function createOAuthProtectedResourceMetadata(
  req: BunRequest<string>,
  path: string,
  auth: MCPOAuthAuthOptions
): OAuthProtectedResourceMetadata {
  const endpointUrl = new URL(path, getOrigin(req));
  const metadata: Omit<OAuthProtectedResourceMetadata, "resource"> =
    auth.metadata ?? {};
  const metadataScopes = Array.isArray(metadata.scopes_supported)
    ? metadata.scopes_supported.filter(
        (scope): scope is string => typeof scope === "string"
      )
    : [];
  const scopesSupported = [
    ...metadataScopes,
    ...(auth.requiredScopes ?? []),
  ];

  return {
    ...metadata,
    resource: endpointUrl.href,
    ...(scopesSupported.length === 0
      ? {}
      : {
          scopes_supported: [...new Set(scopesSupported)],
        }),
  };
}

function createBearerChallenge(
  req: BunRequest<string>,
  path: string,
  auth: MCPOAuthAuthOptions,
  input: {
    error?: string;
    errorDescription?: string;
    scope?: string;
  } = {}
): string {
  const protectedResourceMetadataUrl = new URL(
    getOAuthProtectedResourceMetadataPath(path),
    getOrigin(req)
  );

  const parts = [`resource_metadata="${protectedResourceMetadataUrl.href}"`];

  if (input.error) {
    parts.push(`error="${input.error}"`);
  }

  if (input.errorDescription) {
    parts.push(`error_description="${input.errorDescription}"`);
  }

  if (input.scope) {
    parts.push(`scope="${input.scope}"`);
  }

  return `Bearer ${parts.join(", ")}`;
}

function extractBearerToken(req: BunRequest<string>): string | undefined {
  const header = req.headers.get("authorization");
  if (!header) {
    return undefined;
  }

  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1];
}

async function authenticateOAuthRequest(
  req: BunRequest<string>,
  path: string,
  auth: MCPOAuthAuthOptions
): Promise<{ auth: ResolvedMCPAuthContext<MCPOAuthAuthOptions> } | Response> {
  const token = extractBearerToken(req);

  if (!token) {
    return createUnauthorizedResponse("Missing bearer token", {
      headers: {
        "WWW-Authenticate": createBearerChallenge(req, path, auth, {
          error: "invalid_token",
          errorDescription: "Missing bearer token",
        }),
      },
    });
  }

  const authInfo = await auth.verifyAccessToken(token, req);

  if (!authInfo) {
    return createUnauthorizedResponse("Invalid bearer token", {
      headers: {
        "WWW-Authenticate": createBearerChallenge(req, path, auth, {
          error: "invalid_token",
          errorDescription: "Invalid bearer token",
        }),
      },
    });
  }

  const requiredScopes = auth.requiredScopes ?? [];
  if (requiredScopes.length > 0) {
    const hasAllScopes = requiredScopes.every((scope) =>
      authInfo.scopes.includes(scope)
    );

    if (!hasAllScopes) {
      return createForbiddenResponse("Insufficient scope", {
        headers: {
          "WWW-Authenticate": createBearerChallenge(req, path, auth, {
            error: "insufficient_scope",
            errorDescription: "Insufficient scope",
            scope: requiredScopes.join(" "),
          }),
        },
      });
    }
  }

  return {
    auth: {
      type: "oauth",
      data: authInfo,
    },
  };
}

async function authenticateHeaderRequest<
  TAuth extends MCPHeaderAuthOptions,
>(
  req: BunRequest<string>,
  auth: TAuth
): Promise<{ auth: ResolvedMCPAuthContext<TAuth> } | Response> {
  const validated = await auth.validate(req.headers, req);

  if (!validated) {
    return createUnauthorizedResponse("Unauthorized");
  }

  return {
    auth: {
      type: "header",
      data: validated,
    } as ResolvedMCPAuthContext<TAuth>,
  };
}

async function authenticateQueryRequest<
  TAuth extends MCPQueryAuthOptions,
>(
  req: BunRequest<string>,
  auth: TAuth
): Promise<{ auth: ResolvedMCPAuthContext<TAuth> } | Response> {
  const validated = await auth.validate(new URL(req.url).searchParams, req);

  if (!validated) {
    return createUnauthorizedResponse("Unauthorized");
  }

  return {
    auth: {
      type: "query",
      data: validated,
    } as ResolvedMCPAuthContext<TAuth>,
  };
}

export async function authenticateMCPRequest<
  TAuth extends MCPAuthOptions | undefined,
>(
  req: BunRequest<string>,
  path: string,
  auth: TAuth
): Promise<{ auth?: ResolvedMCPAuthContext<TAuth> } | Response> {
  if (!auth) {
    return {};
  }

  if (auth.type === "oauth") {
    return authenticateOAuthRequest(req, path, auth) as Promise<
      { auth?: ResolvedMCPAuthContext<TAuth> } | Response
    >;
  }

  if (auth.type === "header") {
    return authenticateHeaderRequest(req, auth) as Promise<
      { auth?: ResolvedMCPAuthContext<TAuth> } | Response
    >;
  }

  return authenticateQueryRequest(req, auth) as Promise<
    { auth?: ResolvedMCPAuthContext<TAuth> } | Response
  >;
}
