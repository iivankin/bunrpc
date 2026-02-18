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
