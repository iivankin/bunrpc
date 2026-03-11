# @bunrpc/core

Type-safe RPC for Bun with app-scoped plugins.

## Quick Start

```ts
import { initBunRpc } from "@bunrpc/core";
import { mcp } from "@bunrpc/mcp";
import { openapi } from "@bunrpc/openapi";

const b = initBunRpc({
  prefix: "/api",
  formatInternalServerError: () => ({
    message: "Unexpected server error",
  }),
})
  .use(openapi({
    info: {
      title: "My API",
      version: "1.0.0",
    },
  }))
  .use(mcp({
    path: "/mcp",
    instructions: "Use the available tools.",
  }));

export const { publicProcedure, router } = b;
```

```ts
import { createHttpRoutes } from "@bunrpc/core";
import { publicProcedure, router } from "./bunrpc";
import * as z from "zod";

const createChatInput = z.object({
  title: z.string().min(1),
});

const chat = z.object({
  id: z.string(),
  title: z.string(),
});

const authProcedure = publicProcedure.use(({ req, error, next }) => {
  const authorization = req.headers.get("authorization");

  if (!authorization) {
    return error({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Missing Authorization header",
    });
  }

  return next({
    userId: authorization.replace(/^Bearer\\s+/i, ""),
  });
});

const appRouter = router({
  chat: router({
    list: authProcedure.handler(({ userId }) => [{ id: "1", title: userId }]),
    create: authProcedure
      .input(createChatInput)
      .output(chat)
      .handler(({ input, userId }) => ({
        id: crypto.randomUUID(),
        title: input.title,
        ownerId: userId,
      })),
  }),
});

export type AppRouter = typeof appRouter;

Bun.serve({
  port: 3000,
  routes: {
    ...createHttpRoutes(appRouter).routes,
  },
});
```

## Client

```ts
import { createClient } from "@bunrpc/core";
import type { AppRouter } from "./server";

const client = createClient<AppRouter>({
  baseUrl: "http://localhost:3000/api",
});

const result = await client.chat.list();

if (result.ok) {
  console.log(result.data);
}
```

`createClient()` returns safe-result unions:

- success: `{ ok: true, data }`
- failure: `{ ok: false, error }`

## Core API

- `initBunRpc(options)` creates an app-scoped builder.
- `b.use(plugin)` attaches a typed plugin to that app only.
- `b.publicProcedure` is the base procedure builder.
- `b.router(...)` creates nested routers.
- `createHttpRoutes(router)` generates `Bun.serve()` handlers from a router created by `initBunRpc(...).router(...)`.
- `.input(schema)` validates request payloads.
- `.output(schema)` defines the success output contract and narrows handler return types.
- `.use(middleware)` extends handler context.
- `.handler(fn)` defines the procedure implementation.

## Plugin Model

Plugins are regular values. There is no global registry.

The mental model is:

1. `initBunRpc(...).use(plugin(...))` attaches a plugin to one app instance.
2. That plugin can add typed procedure methods to `b.publicProcedure`.
3. `createHttpRoutes(...)` collects all procedures, their schemas, and plugin metadata.
4. Each plugin gets one `setup(...)` call and can return extra routes plus a typed runtime extension in `http.plugins.<name>`.

A plugin can affect procedures in three different ways:

- `methods`: chainable metadata methods like `.summary(...)` or `.tool(...)`.
- `handlerMethods`: terminal variants that behave like `.handler(...)`, for cases like `.mcpOnlyHandler(...)`.
- `includeProcedureInHttpRoutes(...)`: runtime visibility filter for the normal HTTP surface.

During `setup(...)`, each procedure includes:

- `path` and `fullPath`
- `inputSchema` and `outputSchema`
- `meta` for the current plugin
- `httpExposed`, which tells the plugin whether that procedure is part of the normal RPC/client surface

## Plugin Authoring

```ts
import type { BunRPCPlugin } from "@bunrpc/core";

type DocsMethods = {
  description: (description: string) => { description: string };
};

type DocsMeta = {
  description?: string;
};

export function docsPlugin(): BunRPCPlugin<
  "docs",
  { path: string },
  DocsMethods,
  DocsMeta,
  { documentPath: string }
> {
  return {
    name: "docs",
    options: {
      path: "/docs.json",
    },
    methods: {
      description: (description) => ({ description }),
    },
    setup: ({ options, procedures }) => ({
      extension: {
        documentPath: options.path,
      },
      routes: {
        [options.path]: () =>
          Response.json({
            procedures: procedures.map((procedure) => ({
              path: procedure.fullPath,
              httpExposed: procedure.httpExposed,
              description: procedure.meta?.description,
            })),
          }),
      },
    }),
  };
}
```

Once a plugin is attached with `b.use(docsPlugin())`, its procedure methods become available on `b.publicProcedure`, and its runtime output becomes available on `http.plugins.docs`.

If a plugin needs a terminal method that behaves like `.handler(...)`, use `handlerMethods`. A real example is `@bunrpc/mcp`, where the plugin declares `mcpOnlyHandler` and uses it to hide a procedure from the normal HTTP/client surface while still exposing it through MCP.
