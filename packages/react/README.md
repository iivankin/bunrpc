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
  baseUrl: "/api",
});

function Screen() {
  const query = rpc.chat.list.useQuery();

  if (query.error?.payload.source === "app") {
    console.log(query.error.payload.code);
  }

  return null;
}
```
