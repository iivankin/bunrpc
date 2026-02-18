import { expect, test } from "bun:test";
import { createQueryClient, useRpcUtils } from "./index";

test("exports react helpers", () => {
  expect(typeof createQueryClient).toBe("function");
  expect(typeof useRpcUtils).toBe("function");
});
