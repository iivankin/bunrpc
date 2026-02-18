import { expect, test } from "bun:test";
import { createQueryClient, useRpcUtils } from "./index";
import type { RpcError } from "@bunrpc/core";
import type { AppRpcError, SystemRpcError } from "@bunrpc/core/types";

test("exports react helpers", () => {
  expect(typeof createQueryClient).toBe("function");
  expect(typeof useRpcUtils).toBe("function");
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
