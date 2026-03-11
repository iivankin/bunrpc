# @bunrpc/mcp

MCP server plugin for `@bunrpc/core`.

It adapts bunrpc procedures into MCP tools and exposes an MCP transport route. Your existing bunrpc middleware and handlers still run; the plugin only adds MCP metadata, auth, and transport behavior around them.

## Usage

```ts
import { initBunRpc } from "@bunrpc/core";
import { isMcpRequestContext, mcp } from "@bunrpc/mcp";

const b = initBunRpc().use(
  mcp({
    path: "/mcp",
    instructions: "Use the available tools.",
    auth: {
      type: "header",
      validate: (headers) => {
        const userId = headers.get("x-user");
        if (!userId) {
          return false;
        }

        return {
          userId,
          tenantId: "tenant_1",
        };
      },
    },
  })
);

const { publicProcedure, router } = b;
```

```ts
import { createHttpRoutes } from "@bunrpc/core";
import * as z from "zod";

const createChatInput = z.object({
  title: z.string().min(1),
});

const chat = z.object({
  id: z.string(),
  title: z.string(),
});

const authProcedure = publicProcedure.use((ctx) => {
  if (
    !isMcpRequestContext(ctx) ||
    !ctx.mcp.auth ||
    ctx.mcp.auth.type !== "header"
  ) {
    return ctx.error({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Expected MCP header auth context",
    });
  }

  return ctx.next({
    userId: ctx.mcp.auth.data.userId,
  });
});

const appRouter = router({
  chat: router({
    create: authProcedure
      .input(createChatInput)
      .output(chat)
      .tool({
        title: "Create chat",
        description: "Creates a chat for the current user",
      })
      .mcpOnlyHandler(({ input, userId }) => ({
        id: crypto.randomUUID(),
        title: input.title,
        ownerId: userId,
      })),
  }),
});

const http = createHttpRoutes(appRouter);

http.plugins.mcp.path;
http.routes["/mcp"];
```

## What `mcp(...)` Adds

After `b.use(mcp(...))` you get:

- an MCP transport route, `/mcp` by default
- typed procedure methods for tool metadata
- MCP-aware handler context via `ctx.requestSource === "mcp"` and `ctx.mcp`
- a typed runtime extension at `http.plugins.mcp`

## Procedure Methods

After `b.use(mcp(...))`, procedures get:

- `.tool()`
- `.tool("custom_name")`
- `.tool({ name, title, description, annotations, execution, icons, _meta })`
- `.mcpOnlyHandler(...)`

If `name` is omitted, it is generated from the RPC path in `snake_case`:

- `chat.create` -> `chat_create`
- `docs.queryAll` -> `docs_query_all`

`mcpOnlyHandler(...)` behaves like `.handler(...)`, but marks the procedure as MCP-only. It will still be available through `/mcp`, and it will not be exposed as a regular Bun RPC HTTP route under your configured `/api/...` prefix.

That also means MCP-only procedures are hidden from the generated RPC client types and from OpenAPI.

## Input and Output Contracts

MCP tools must define both:

- `.input(schema)`
- `.output(schema)`

If either is missing, `createHttpRoutes(...)` throws during startup.

`.tool(...)` only marks a procedure as an MCP tool. The actual implementation still comes from `.handler(...)` or `.mcpOnlyHandler(...)`.

## Auth Modes

`@bunrpc/mcp` supports three transport-level auth modes:

### `oauth`

```ts
mcp({
  auth: {
    type: "oauth",
    verifyAccessToken: async (token, req) => {
      return token === "valid-token"
        ? { token, clientId: "my-client", scopes: ["tools:read"] }
        : null;
    },
    requiredScopes: ["tools:read"],
  },
})
```

This returns MCP/OAuth challenges on the HTTP boundary and exposes verified auth info in `ctx.mcp.auth`.

### `header`

```ts
mcp({
  auth: {
    type: "header",
    validate: (headers) => {
      const userId = headers.get("x-user");
      return userId ? { userId } : false;
    },
  },
})
```

The return type of `validate(...)` becomes `ctx.mcp.auth.data`.

### `query`

```ts
mcp({
  auth: {
    type: "query",
    validate: (searchParams) => {
      const apiTokenId = searchParams.get("token");
      return apiTokenId ? { apiTokenId } : false;
    },
  },
})
```

The return type of `validate(...)` also flows into `ctx.mcp.auth.data`.

`header` validators receive the full `Headers` object, and `query` validators receive the full `URLSearchParams`. That lets you validate combinations of values instead of hard-coding one header name or one query key in the plugin config.

## Handler Context

When a tool is called through MCP:

- `ctx.requestSource === "mcp"`
- `ctx.mcp.toolName` is the resolved MCP tool name
- `ctx.mcp.sessionId` contains the current session when available
- `ctx.mcp.auth` contains the verified transport auth context

Use `isMcpRequestContext(ctx)` to narrow the context inside middleware and handlers.

## `tool(...)` Options

`tool(...)` mirrors the MCP `Tool` shape exposed by the SDK:

- `name`: stable MCP tool id. If omitted, bunrpc generates `snake_case` from the RPC path.
- `title`: human-readable label for MCP clients.
- `description`: longer explanation shown in clients.
- `annotations`: MCP hints like `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`.
- `execution`: SDK execution metadata for clients that understand task/execution hints.
- `icons`: SDK presentation metadata for clients that can render tool icons.
- `_meta`: raw MCP metadata escape hatch.

`name`, `title`, `description`, `annotations`, `_meta`, `inputSchema`, and `outputSchema` are standard MCP tool fields. `execution` and `icons` also come from the current `@modelcontextprotocol/sdk` type surface and are passed through unchanged.
