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
