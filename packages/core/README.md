# @bunrpc/core

Type-safe RPC core for Bun with Standard Schema validation and safe client results.

## Installation

```bash
bun add @bunrpc/core
```

Optional package for React Query integration:

```bash
bun add @bunrpc/react @tanstack/react-query
```

## Quick Start

### 1) Define server procedures

```ts
import {
  createbrpcRoutes,
  createProcedure,
  createRouter,
} from "@bunrpc/core";
import * as z from "zod";

const CreateChatSchema = z.object({
  title: z.string().min(1),
});

const publicProcedure = createProcedure();

const authProcedure = publicProcedure.use(async ({ req, error, next }) => {
  const token = req.headers.get("authorization");
  if (!token) {
    return error({
      code: "UNAUTHORIZED",
      status: 401,
      message: "Unauthorized",
    });
  }

  return next({ userId: "user_1" });
});

const chatRouter = createRouter({
  list: authProcedure.handler(({ userId }) => {
    return [{ id: "chat_1", title: `General (${userId})` }];
  }),
  create: authProcedure
    .input(CreateChatSchema)
    .handler(({ input, userId, error }) => {
      if (input.title.length > 120) {
        return error({
          code: "TITLE_TOO_LONG",
          status: 400,
          message: "Title is too long",
          details: { max: 120 },
        });
      }

      return { id: "chat_2", title: input.title, ownerId: userId };
    }),
});

const rpc = createbrpcRoutes(
  { chat: chatRouter },
  {
    prefix: "/api",
    formatInternalServerError: (_error, event) => ({
      message: "Unexpected server error",
      details: { requestPath: event.path },
    }),
  }
);

Bun.serve({
  port: 3000,
  routes: {
    ...rpc.routes,
  },
});

export type AppRouter = typeof rpc._router;
```

### 2) Use safe client API

```ts
import { createClient, isAppError, isValidationError } from "@bunrpc/core";
import type { AppRouter } from "./server";

const client = createClient<AppRouter>({
  baseUrl: "/api",
});

const result = await client.chat.create({ title: "Roadmap" });

if (!result.ok) {
  if (isAppError(result)) {
    if (result.error.code === "TITLE_TOO_LONG") {
      console.log(result.error.details?.max);
    }
  } else if (isValidationError(result)) {
    console.log(result.error.details.issues);
  } else {
    console.log("Something went wrong");
  }
}
```

### 3) React Query integration

Use `@bunrpc/react`:

```ts
import { createQueryClient } from "@bunrpc/react";
import type { AppRouter } from "./server";

const rpc = createQueryClient<AppRouter>({ baseUrl: "/api" });
```

## API Overview

- `createProcedure()`
- `createRouter()`
- `createbrpcRoutes()`
- `createClient()`
- `isAppError(result)`
- `isValidationError(result)`
- `RpcError<TPayload>`

For advanced utility types, import from `@bunrpc/core/types`.
