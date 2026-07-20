import { expect, test } from "bun:test";
import type { RpcError } from "@bunrpc/core";
import type {
  AppRpcError,
  Procedure,
  SystemRpcError,
} from "@bunrpc/core/types";
import { createQueryClient, useRpcUtils } from "./index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

test("exports react helpers", () => {
  expect(typeof createQueryClient).toBe("function");
  expect(typeof useRpcUtils).toBe("function");
});

test("query client keeps route proxies and inputless query keys stable", () => {
  type ListProcedure = Procedure<
    Record<string, never>,
    undefined,
    { items: string[] },
    never
  >;
  const rpc = createQueryClient<{
    chat: { list: ListProcedure };
  }>();

  expect(rpc.chat).toBe(rpc.chat);
  expect(rpc.chat.list).toBe(rpc.chat.list);
  expect(rpc.chat.list.getQueryKey).toBe(rpc.chat.list.getQueryKey);
  expect(rpc.chat.list.getQueryKey()).toBe(rpc.chat.list.getQueryKey());
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
  type HasInitialCursor = "initialCursor" extends keyof OptionsArg
    ? true
    : false;
  type HasGetNextCursor = "getNextCursor" extends keyof OptionsArg
    ? true
    : false;

  type _AssertInputArg = Expect<Equal<InputArg, { limit: number }>>;
  type _AssertNoInitialPageParam = Expect<Equal<HasInitialPageParam, false>>;
  type _AssertNoGetNextPageParam = Expect<Equal<HasGetNextPageParam, false>>;
  type _AssertHasInitialCursor = Expect<Equal<HasInitialCursor, true>>;
  type _AssertHasGetNextCursor = Expect<Equal<HasGetNextCursor, true>>;
  type _AssertCursorParam = Expect<
    Equal<OptionsArg["initialCursor"], string | undefined>
  >;
  type _AssertStrictCursorOnly = Expect<
    Equal<typeof rpc.chat.byPage.useInfiniteQuery, never>
  >;
  const _getNextCursor: OptionsArg["getNextCursor"] = (lastPage) =>
    lastPage.nextCursor;
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
  type HasSignal = MutateOptions extends { signal?: AbortSignal }
    ? true
    : false;
  type HasHeaders = MutateOptions extends {
    headers?: Headers | Record<string, string>;
  }
    ? true
    : false;

  type _AssertMutateInput = Expect<Equal<MutateInput, { title: string }>>;
  type _AssertSignal = Expect<Equal<HasSignal, true>>;
  type _AssertHeaders = Expect<Equal<HasHeaders, true>>;
  const _mutateOptions: MutateOptions = {
    signal: new AbortController().signal,
    headers: { Authorization: "Bearer token" },
    onSuccess: (_data, variables) => {
      const title: string = variables.title;
      return title;
    },
  };
  const _mutateAsyncOptions: MutateAsyncOptions = {
    signal: new AbortController().signal,
    onError: (_error, variables) => {
      const title: string = variables.title;
      return title;
    },
  };

  expect(typeof rpc.chat.create.useMutation).toBe("function");
});

{
  type EmitProcedure = Procedure<
    Record<string, never>,
    { prompt: string },
    { runId: string },
    never
  >;

  const rpc = createQueryClient<{
    emit: {
      run: EmitProcedure;
    };
  }>();

  type Mutation = ReturnType<typeof rpc.emit.run.useMutation>;

  const _readRunId = (mutation: Mutation): string | null => {
    if (mutation.isSuccess) {
      return mutation.data.runId;
    }

    return null;
  };
}

{
  type ErrorUnion =
    | AppRpcError<"TITLE_TOO_LONG", { max: number }>
    | SystemRpcError<"BAD_RESPONSE">;

  const _readMax = (error: RpcError<ErrorUnion>): number | null => {
    if (error.source === "app" && error.code === "TITLE_TOO_LONG") {
      const code: "TITLE_TOO_LONG" = error.code;
      return (error.details?.max ?? 0) + (code === "TITLE_TOO_LONG" ? 0 : 1);
    }

    return null;
  };
}
