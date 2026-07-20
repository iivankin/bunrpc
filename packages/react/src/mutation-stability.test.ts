import { expect, test } from "bun:test";
import type { Procedure } from "@bunrpc/core/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, useState } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { createQueryClient } from "./index";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type CreateProcedure = Procedure<
  Record<string, never>,
  { title: string },
  { id: string },
  never
>;

test("mutation functions stay stable across rerenders", async () => {
  const client = new QueryClient();
  const rpc = createQueryClient<{
    chat: { create: CreateProcedure };
  }>();
  let forceRerender: (() => void) | undefined;
  let latestMutation:
    | ReturnType<typeof rpc.chat.create.useMutation>
    | undefined;

  const Harness = () => {
    const [, setRevision] = useState(0);
    forceRerender = () => setRevision((revision) => revision + 1);
    latestMutation = rpc.chat.create.useMutation();
    return null;
  };

  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(
      createElement(QueryClientProvider, { client }, createElement(Harness))
    );
  });

  const initialMutate = latestMutation?.mutate;
  const initialMutateAsync = latestMutation?.mutateAsync;
  expect(initialMutate).toBeFunction();
  expect(initialMutateAsync).toBeFunction();

  await act(() => forceRerender?.());

  expect(latestMutation?.mutate).toBe(initialMutate);
  expect(latestMutation?.mutateAsync).toBe(initialMutateAsync);

  await act(() => renderer?.unmount());
});
