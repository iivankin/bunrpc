# @bunrpc/react

React Query helpers for `@bunrpc/core`.

## Installation

```bash
bun add @bunrpc/core @bunrpc/react @tanstack/react-query
```

## Usage

```ts
import { createQueryClient } from "@bunrpc/react";
import type { AppRouter } from "./server";

const rpc = createQueryClient<AppRouter>({
  baseUrl: "/api", // Default value
  log: true, // Default outside production
});

function Screen() {
  const query = rpc.chat.list.useQuery();

  if (
    query.error?.source === "app" &&
    query.error.code === "TITLE_TOO_LONG"
  ) {
    console.log(query.error.details?.max);
  }

  return null;
}
```

TanStack Query cancellation is forwarded to the underlying `fetch` via `AbortSignal` for `useQuery` and `useInfiniteQuery`.

Mutations support per-call request options through the wrapped mutation helpers:

```ts
const mutation = rpc.chat.create.useMutation();
const controller = new AbortController();

mutation.mutate(
  { title: "Roadmap" },
  {
    signal: controller.signal,
    headers: {
      Authorization: "Bearer demo-user",
    },
  }
);
```

`createQueryClient` forwards `log` to `@bunrpc/core/createClient`, so development request/response traces are enabled by default outside production.
## Infinite queries

`useInfiniteQuery` is available for procedures whose input includes a `cursor` field.

`pageParam` is always merged into the procedure input as `cursor`, so paginated procedures should accept an object input with optional `cursor`.

```ts
const feedQuery = rpc.feed.list.useInfiniteQuery(
  { limit: 20 },
  {
    getNextCursor: (lastPage) => lastPage.nextCursor,
    // initialCursor: "cursor_0", // optional
  }
);
```
