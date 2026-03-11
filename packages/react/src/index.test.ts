import { expect, test } from "bun:test";
import { createQueryClient, useRpcUtils } from "./index";
import type { RpcError } from "@bunrpc/core";
import type {
  AppRpcError,
  Procedure,
  SystemRpcError,
} from "@bunrpc/core/types";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() =>
  T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

test("exports react helpers", () => {
  expect(typeof createQueryClient).toBe("function");
  expect(typeof useRpcUtils).toBe("function");
});

test("query client exposes useInfiniteQuery helper", () => {
  type CursorProcedure = Procedure<
    Record<string, never>,
    { limit: number; cursor?: string },
    { items: string[]; nextCursor?: string },
    never
  >;
  type NoCursorProcedure = Procedure<
    Record<string, never>,
    { page: number },
    { items: string[] },
    never
  >;

  const rpc = createQueryClient<{
    chat: {
      list: CursorProcedure;
      byPage: NoCursorProcedure;
    };
  }>();

  expect(typeof rpc.chat.list.useInfiniteQuery).toBe("function");

  type InfiniteQueryArgs = Parameters<typeof rpc.chat.list.useInfiniteQuery>;
  type InputArg = InfiniteQueryArgs[0];
  type OptionsArg = InfiniteQueryArgs[1];
  type HasInitialPageParam = "initialPageParam" extends keyof OptionsArg
    ? true
    : false;
  type HasGetNextPageParam = "getNextPageParam" extends keyof OptionsArg
    ? true
    : false;
  type HasInitialCursor = "initialCursor" extends keyof OptionsArg ? true : false;
  type HasGetNextCursor = "getNextCursor" extends keyof OptionsArg ? true : false;

  const assertInputArg: Expect<Equal<InputArg, { limit: number }>> = true;
  const assertNoInitialPageParam: Expect<Equal<HasInitialPageParam, false>> = true;
  const assertNoGetNextPageParam: Expect<Equal<HasGetNextPageParam, false>> = true;
  const assertHasInitialCursor: Expect<Equal<HasInitialCursor, true>> = true;
  const assertHasGetNextCursor: Expect<Equal<HasGetNextCursor, true>> = true;
  const assertCursorParam: Expect<Equal<OptionsArg["initialCursor"], string | undefined>> =
    true;
  const getNextCursor: OptionsArg["getNextCursor"] = (lastPage) =>
    lastPage.nextCursor;
  const _strictCursorOnly: never = rpc.chat.byPage.useInfiniteQuery;

  expect(
    assertInputArg &&
      assertNoInitialPageParam &&
      assertNoGetNextPageParam &&
      assertHasInitialCursor &&
      assertHasGetNextCursor &&
      assertCursorParam &&
      !!getNextCursor
  ).toBe(true);
});

test("mutation client accepts request options on mutate calls", () => {
  type CreateProcedure = Procedure<
    Record<string, never>,
    { title: string },
    { id: string },
    never
  >;

  const rpc = createQueryClient<{
    chat: {
      create: CreateProcedure;
    };
  }>();

  type MutationHook = ReturnType<typeof rpc.chat.create.useMutation>;
  type MutateArgs = Parameters<MutationHook["mutate"]>;
  type MutateAsyncArgs = Parameters<MutationHook["mutateAsync"]>;
  type MutateInput = MutateArgs[0];
  type MutateOptions = NonNullable<MutateArgs[1]>;
  type MutateAsyncOptions = NonNullable<MutateAsyncArgs[1]>;
  type HasSignal = MutateOptions extends { signal?: AbortSignal } ? true : false;
  type HasHeaders = MutateOptions extends {
    headers?: Record<string, string>;
  }
    ? true
    : false;

  const assertMutateInput: Expect<Equal<MutateInput, { title: string }>> = true;
  const assertSignal: Expect<Equal<HasSignal, true>> = true;
  const assertHeaders: Expect<Equal<HasHeaders, true>> = true;
  const mutateOptions: MutateOptions = {
    signal: new AbortController().signal,
    headers: { Authorization: "Bearer token" },
    onSuccess: (_data, variables) => {
      const title: string = variables.title;
      return title;
    },
  };
  const mutateAsyncOptions: MutateAsyncOptions = {
    signal: new AbortController().signal,
    onError: (_error, variables) => {
      const title: string = variables.title;
      return title;
    },
  };

  expect(
    assertMutateInput &&
      assertSignal &&
      assertHeaders &&
      !!mutateOptions &&
      !!mutateAsyncOptions
  ).toBe(true);
});

test("rpc error narrows by top-level source/code", () => {
  type ErrorUnion =
    | AppRpcError<"TITLE_TOO_LONG", { max: number }>
    | SystemRpcError<"BAD_RESPONSE">;

  const readMax = (error: RpcError<ErrorUnion>): number | null => {
    if (error.source === "app" && error.code === "TITLE_TOO_LONG") {
      const code: "TITLE_TOO_LONG" = error.code;
      return (error.details?.max ?? 0) + (code === "TITLE_TOO_LONG" ? 0 : 1);
    }

    return null;
  };

  expect(readMax as unknown).toBeDefined();
});
