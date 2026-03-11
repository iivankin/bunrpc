# @bunrpc/openapi

OpenAPI plugin for `@bunrpc/core`.

## Installation

```bash
bun add @bunrpc/openapi
```

## Usage

```ts
import { createProcedure, createRouter, createBunRPCRoutes, useRouterPlugin } from "@bunrpc/core";
import { createOpenAPIPlugin } from "@bunrpc/openapi";

const openapi = createOpenAPIPlugin();
const publicProcedure = createProcedure().use(openapi());

const router = createRouter(
  {
    list: publicProcedure
      .summary("List chats")
      .description("Returns all chats")
      .handler(() => []),
  },
  {
    plugins: [
      useRouterPlugin(openapi, {
        info: {
          title: "My API",
          version: "1.0.0",
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
            },
          },
        },
        security: [{ bearerAuth: [] }],
        documentPath: "/openapi.json",
        swagger: {
          path: "/docs",
          persistAuthorization: true,
        },
      }),
    ],
  }
);

const rpc = createBunRPCRoutes({ chat: router });
```

This package generates a `POST` operation for each BunRPC procedure path. If `swagger` is enabled, it also serves a Swagger UI HTML page.

- Procedures without explicit `.tags(...)` are grouped by the first router segment, so `/api/chat/list` shows under `chat` and `/api/auth/token` under `auth`.
- If your input schema exposes `~standard.jsonSchema.input()` or `toJSONSchema()` (for example Zod v4), the request body schema is generated automatically from `.input(...)`.
- To show the Swagger `Authorize` button, define `components.securitySchemes` and `security` in `useRouterPlugin(openapi, ...)`.
