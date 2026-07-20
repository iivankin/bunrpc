import { expect, mock, test } from "bun:test";
import type { Procedure } from "@bunrpc/core/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, useState } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { createQueryClient } from "./index";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type ListProcedure = Procedure<
  Record<string, never>,
  undefined,
  { items: string[] },
  never
>;

test("queries do not refetch on consumer rerenders", async () => {
  const fetchMock = mock(async () => Response.json({ items: ["one"] }));
  const client = new QueryClient();
  const rpc = createQueryClient<{
    chat: { list: ListProcedure };
  }>({ fetch: fetchMock, log: false });
  let forceRerender: (() => void) | undefined;
  let latestQuery: ReturnType<typeof rpc.chat.list.useQuery> | undefined;

  const Harness = () => {
    const [, setRevision] = useState(0);
    forceRerender = () => setRevision((revision) => revision + 1);
    latestQuery = rpc.chat.list.useQuery({
      retry: false,
      staleTime: Number.POSITIVE_INFINITY,
    });
    return null;
  };

  let renderer: ReactTestRenderer | undefined;
  await act(async () => {
    renderer = create(
      createElement(QueryClientProvider, { client }, createElement(Harness))
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const initialRefetch = latestQuery?.refetch;
  expect(initialRefetch).toBeFunction();
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(() => forceRerender?.());

  expect(latestQuery?.refetch).toBe(initialRefetch);
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await act(() => renderer?.unmount());
});
