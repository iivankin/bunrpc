# @bunrpc/core

Type-safe RPC core for Bun.

## Features

- End-to-end type inference from router to client
- Middleware with context propagation via `next(...)`
- App + system error unions per procedure
- Safe client results (no throws in `createClient`)
- Standard Schema input validation
- React Query integration via `@bunrpc/react`

## Installation

```bash
bun add @bunrpc/core
```

For React Query integration (recommended for frontend apps):

```bash
bun add @bunrpc/react @tanstack/react-query
```

For `.input(...)`, use any validation library that implements Standard Schema.

## Schema examples (`./schemas.ts`)

Zod:

```ts
import * as z from "zod";

export const CreateChatSchema = z.object({
  title: z.string().min(1),
});
```

Valibot:

```ts
import * as v from "valibot";

export const CreateChatSchema = v.object({
  title: v.pipe(v.string(), v.minLength(1, "Title is required")),
});
```

## Quick Start

### 1) Define server procedures

```ts
import {
  createBunRPCRoutes,
  createProcedure,
  createRouter,
} from "@bunrpc/core";
import { CreateChatSchema } from "./schemas";

const publicProcedure = createProcedure();

const loggedProcedure = publicProcedure.use(async (opts) => {
  const start = Date.now();
  const result = await opts.next();
  const durationMs = Date.now() - start;

  const meta = {
    path: opts.path,
    type: opts.type,
    durationMs,
  };

  result.ok
    ? console.log("OK request timing:", meta)
    : console.error("Non-OK request timing:", meta);

  return result;
});

// Middleware:
// - return opts.next(...) to continue
// - or return error({...}) to stop with app error
// - middleware can be sync or async
// - for cookies use req.cookies (Bun CookieMap)

const authProcedure = loggedProcedure.use(({ req, error, next }) => {
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

// Bun CookieMap helpers are available on req.cookies.
// Bun automatically reflects set/delete calls into Set-Cookie response headers.
const sessionProcedure = publicProcedure.use(({ req, next }) => {
  if (!req.cookies.has("session")) {
    req.cookies.set("session", "session_1", { path: "/", httpOnly: true });
  }

  req.cookies.delete("legacy_session", { path: "/" });
  return next();
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

const rpc = createBunRPCRoutes(
  { chat: chatRouter },
  {
    prefix: "/api", // default value
    formatInternalServerError: (_error, event) => {
      return {
        message: "Unexpected server error",
        details: {
          requestPath: event.path,
        },
      };
    },
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

### 2) React Query integration (recommended)

```ts
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient, useRpcUtils } from "@bunrpc/react";
import type { AppRouter } from "./server";

const queryClient = new QueryClient();
const rpc = createQueryClient<AppRouter>({
  baseUrl: "/api", // default value
  log: true, // default outside production
});

function ChatList() {
  const query = rpc.chat.list.useQuery();

  if (query.error) {
    if (
      query.error.source === "app" &&
      query.error.code === "TITLE_TOO_LONG"
    ) {
      console.log(query.error.details?.max);
    } else {
      // system errors (network/validation/internal)
      console.log("Something went wrong");
    }
  }

  return <pre>{JSON.stringify(query.data, null, 2)}</pre>;
}

function CreateChat() {
  const { invalidate } = useRpcUtils(rpc);

  const mutation = rpc.chat.create.useMutation({
    onSuccess: async () => {
      await invalidate(rpc.chat.list);
    },
  });

  return (
    <button onClick={() => mutation.mutate({ title: "Roadmap" })}>
      Create chat
    </button>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ChatList />
      <CreateChat />
    </QueryClientProvider>
  );
}
```

### 3) Use safe client API (non-React flows)

```ts
import { createClient, isAppError, isValidationError } from "@bunrpc/core";
import type { AppRouter } from "./server";

const client = createClient<AppRouter>({
  baseUrl: "/api", // default value
  log: true, // default outside production
});

const result = await client.chat.create({ title: "Roadmap" });

const abortController = new AbortController();
const authedResult = await client.chat.create(
  { title: "Roadmap" },
  {
    headers: {
      Authorization: "Bearer demo-user",
    },
    signal: abortController.signal,
  }
);

if (!result.ok) {
  if (isAppError(result)) {
    // only errors returned by error({...}) from middleware/handler
    if (result.error.code === "TITLE_TOO_LONG") {
      console.log(result.error.details?.max);
    }
  } else if (isValidationError(result)) {
    console.log(result.error.details.issues);
  } else {
    // system/transport errors -> show generic message
    console.log("Something went wrong");
  }
}
```

If frontend and API are on the same domain, use `baseUrl: "/api"` (or omit `baseUrl` entirely since `"/api"` is default).

`createClient` and `createQueryClient` support `log`, which prints styled request/response traces in development and defaults to `true` outside production.

Per-request request options are passed as the second argument. For procedures without input, use `client.ping(undefined, { signal })`.

## Plugins

`@bunrpc/core` supports typed plugins for router-level extensions such as OpenAPI or MCP.

```ts
import {
  createBunRPCRoutes,
  createProcedure,
  createRouter,
  definePlugin,
  useRouterPlugin,
} from "@bunrpc/core";

const openapiPlugin = definePlugin<
  "openapi",
  {
    description: (description: string) => { description: string };
  },
  { documentPath: string },
  { document: { paths: string[] } }
>({
  name: "openapi",
  procedure: {
    description: (description) => ({ description }),
  },
  setup: ({ options, procedures }) => {
    const document = {
      paths: procedures.map((procedure) => procedure.fullPath),
    };

    return {
      extension: { document },
      routes: {
        [options.documentPath]: () => Response.json(document),
      },
    };
  },
});

const publicProcedure = createProcedure().use(openapiPlugin());

const chatRouter = createRouter(
  {
    list: publicProcedure
      .description("List chats")
      .handler(() => []),
  },
  {
    plugins: [
      useRouterPlugin(openapiPlugin, {
        documentPath: "/openapi.json",
      }),
    ],
  }
);

const rpc = createBunRPCRoutes({ chat: chatRouter });

rpc.plugins.openapi.document.paths;
rpc.routes["/openapi.json"];
```

## Error Model

- App errors (`source: "app"`) come from `return error({...})` in middleware or handler.
- System errors (`source: "system"`) are generated by transport/runtime layers.
- App errors from shared middleware (for example `authProcedure`) are included in every downstream procedure's error union.

Common system codes:

- `NETWORK_ERROR`
- `BAD_RESPONSE`
- `METHOD_NOT_ALLOWED`
- `INVALID_JSON`
- `VALIDATION_ERROR` (typed details: `{ issues: Array<{ path: string; message: string }> }`)
- `HTTP_ERROR`
- `INTERNAL_SERVER_ERROR`

## API Overview

- `createProcedure().use(plugin())` - register a procedure plugin and expose its custom builder methods
- `createRouter()` - group procedures in a nested router
- `definePlugin()` - create a typed plugin descriptor
- `definePlugin({ procedure: { ... } })` - declare custom procedure builder methods such as `.description(...)`
- `useRouterPlugin()` - register a plugin on a router with typed options
- `createBunRPCRoutes()` - generate `Bun.serve()` route handlers with optional internal error formatter
- cookies: use Bun `req.cookies` (`CookieMap`) in middleware/handlers
- `createClient()` - safe RPC client returning `RpcResult`
- `isAppError(result)` - type guard for app errors in safe results
- `isValidationError(result)` - type guard for `VALIDATION_ERROR` in safe results
- `createQueryClient()` (`@bunrpc/react`) - React Query integration
- `RpcError<TPayload>` - typed error class used by React Query flow

For advanced/internal utility types, import from `@bunrpc/core/types`.
