# bunrpc

Type-safe RPC for Bun: define procedures on the server, get a typed client on the frontend, and optionally plug into React Query.

## Features

- End-to-end type inference from your router
- Procedure middleware for auth/context composition
- Input validation via Standard Schema (`~standard.validate`)
- Auto-generated `Bun.serve()` route handlers
- Typed RPC client for browser/server usage
- Optional React Query integration (`useQuery`, `useMutation`, cache invalidation)

## Installation

```bash
bun add bunrpc
```

Optional dependencies:

```bash
# If you use React Query integration
bun add @tanstack/react-query
```

For procedure input schemas, use any validator library that implements Standard Schema.

### Schema examples (`./schemas.ts`)

`createProcedure().input(...)` accepts any `StandardSchemaV1`.

Zod (works out of the box because Zod implements Standard Schema):

```ts
import * as z from "zod";

export const CreateChatSchema = z.object({
  title: z.string().min(1),
});
```

Valibot (also works out of the box):

```ts
import * as v from "valibot";

export const CreateChatSchema = v.object({
  title: v.pipe(v.string(), v.minLength(1, "Title is required")),
});
```

## Quick Start

### 1) Define your server router

```ts
import {
  HttpError,
  createBunRPCRoutes,
  createProcedure,
  createRouter,
  wrapRoutes,
} from "bunrpc";
import { CreateChatSchema } from "./schemas";

const publicProcedure = createProcedure();

const authProcedure = publicProcedure.use(async ({ req }) => {
  const token = req.headers.get("authorization");
  if (!token) {
    throw new HttpError(401, "Unauthorized");
  }

  return { userId: "user_1" };
});

const chatRouter = createRouter({
  list: authProcedure.handler(async ({ userId }) => {
    return [{ id: "chat_1", title: `General (${userId})` }];
  }),
  create: authProcedure
    .input(CreateChatSchema)
    .handler(async ({ input, userId }) => {
      return { id: "chat_2", title: input.title, ownerId: userId };
    }),
});

const rpc = createBunRPCRoutes({ chat: chatRouter }, { prefix: "/api" });

Bun.serve({
  port: 3000,
  routes: {
    ...wrapRoutes(rpc.routes),
  },
});

export type AppRouter = typeof rpc._router;
```

### 2) Create a typed client

```ts
import { createClient } from "bunrpc";
import type { AppRouter } from "./server";

const client = createClient<AppRouter>({
  baseUrl: "http://localhost:3000/api",
});

const chats = await client.chat.list();
const newChat = await client.chat.create({ title: "Roadmap" });
```

### 3) React Query integration (optional)

```ts
import { createQueryClient, useRpcUtils } from "bunrpc/react";
import type { AppRouter } from "./server";

const rpc = createQueryClient<AppRouter>({ baseUrl: "/api" });

function ChatList() {
  const { data } = rpc.chat.list.useQuery();
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}

function NewChatButton() {
  const { invalidate } = useRpcUtils(rpc);
  const mutation = rpc.chat.create.useMutation({
    onSuccess: () => invalidate(rpc.chat.list),
  });

  return (
    <button onClick={() => mutation.mutate({ title: "New chat" })}>
      Create chat
    </button>
  );
}
```

## Error Handling

- On server side, throw `HttpError(status, message, details?)` in middleware/handlers.
- `wrapRoutes()` converts `HttpError` into JSON responses and logs request metadata.
- On client side, failed requests throw `RpcError` with `.status` and optional `.details`.

## API Overview

- `createProcedure()` - procedure builder with `.use()`, `.input()`, `.handler()`
- `createRouter()` - groups procedures into a typed router tree
- `createBunRPCRoutes()` - transforms router into `Bun.serve()` route handlers
- `wrapRoutes()` - adds logging and error handling for generated routes
- `createClient()` - creates a type-safe RPC client
- `createQueryClient()` (`bunrpc/react`) - creates React Query-aware RPC helpers
- `useRpcUtils()` (`bunrpc/react`) - cache utilities on top of `useQueryClient()`
- `StandardSchemaV1` - schema contract type accepted by `.input(...)`
- `HttpError` and `RpcError` - server/client error classes

## Local Development

```bash
bun install
bun run check
```

## Publishing

```bash
bun publish --access public
```
