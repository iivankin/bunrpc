# @bunrpc/openapi

OpenAPI plugin for `@bunrpc/core`.

It is a documentation plugin: it does not change how procedures execute, and it does not add runtime response validation by itself.

## Usage

```ts
import { initBunRpc } from "@bunrpc/core";
import { openapi } from "@bunrpc/openapi";

const b = initBunRpc().use(
  openapi({
    info: {
      title: "My API",
      version: "1.0.0",
    },
    documentPath: "/openapi.json",
    swagger: {
      path: "/docs",
      persistAuthorization: true,
      displayOperationId: true,
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
}).meta({ title: "Chat" });

const appRouter = router({
  chat: router({
    list: publicProcedure
      .summary("List chats")
      .description("Returns all chats")
      .handler(() => []),
    create: publicProcedure
      .input(createChatInput)
      .output(chat)
      .summary("Create chat")
      .security({ bearerAuth: [] })
      .responses({
        "400": {
          description: "Invalid input",
        },
      })
      .handler(({ input }) => ({
        id: crypto.randomUUID(),
        title: input.title,
      })),
  }),
});

const http = createHttpRoutes(appRouter);

http.plugins.openapi.document;
http.routes["/openapi.json"];
http.routes["/docs"];
```

## What `openapi(...)` Adds

After `b.use(openapi(...))` you get:

- typed procedure metadata methods for describing operations
- an OpenAPI document route, `/openapi.json` by default
- an optional Swagger UI route
- a typed runtime extension at `http.plugins.openapi.document`

## Procedure Methods

After `b.use(openapi(...))`, procedures get these typed methods:

- `.operationId(string)`
- `.summary(string)`
- `.description(string)`
- `.tags(...string[])`
- `.deprecated(boolean?)`
- `.security(...requirements)`
- `.requestBody(body)`
- `.responses(responses)`

`summary` and `description` are optional. If you do not call them, the operation still appears in the generated document.

Only procedures that are part of the normal HTTP surface are included in the document. Plugin-hidden routes, such as MCP-only handlers, are skipped automatically.

## Output Schemas

If a procedure uses `.output(schema)`, the plugin:

- generates the `200` response schema from that output contract
- merges it with explicit `.responses(...)`
- reuses named schemas with `title` in `components.schemas` when the same schema appears more than once

## Swagger

Set `swagger: true` for defaults, or pass `swagger` options:

```ts
swagger: {
  path: "/docs",
  title: "My API Docs",
  persistAuthorization: true,
  displayOperationId: true,
  filter: true,
}
```

The Swagger page uses the upstream `swagger-ui-dist` assets from `unpkg`.
