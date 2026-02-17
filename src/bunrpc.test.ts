import { describe, expect, mock, test } from "bun:test";
import {
  createBunRPCRoutes,
  createClient,
  createProcedure,
  createRouter,
} from "./index";
import type { StandardSchemaV1 } from "./types";

function createSingleStringFieldSchema<TKey extends string>(
  key: TKey
): StandardSchemaV1<unknown, Record<TKey, string>> {
  return {
    "~standard": {
      version: 1,
      vendor: "bunrpc-test",
      validate: (value: unknown) => {
        if (typeof value !== "object" || value === null) {
          return { issues: [{ message: "Expected object" }] };
        }

        const fieldValue = (value as Record<string, unknown>)[key];
        if (typeof fieldValue !== "string") {
          return {
            issues: [
              {
                message: `Expected ${key} to be string`,
                path: [key],
              },
            ],
          };
        }

        return {
          value: {
            [key]: fieldValue,
          } as Record<TKey, string>,
        };
      },
    },
  };
}

describe("bunrpc", () => {
  describe("createProcedure", () => {
    test("creates a procedure without input", () => {
      const procedure = createProcedure().handler(() => ({ message: "ok" }));

      expect(procedure._type).toBe("procedure");
      expect(procedure.inputSchema).toBeUndefined();
      expect(procedure.middlewares).toHaveLength(0);
    });

    test("creates a procedure with input schema", () => {
      const schema = createSingleStringFieldSchema("name");
      const procedure = createProcedure()
        .input(schema)
        .handler(({ input }) => ({ created: input.name }));

      expect(procedure._type).toBe("procedure");
      expect(procedure.inputSchema).toBeDefined();
    });

    test("chains middlewares", () => {
      const procedure = createProcedure()
        .use(async () => ({ user: { id: "1" } }))
        .use(async ({ user }) => ({ isAdmin: user.id === "1" }))
        .handler(({ user, isAdmin }) => ({ user, isAdmin }));

      expect(procedure.middlewares).toHaveLength(2);
    });
  });

  describe("createRouter", () => {
    test("creates a router from procedures", () => {
      const router = createRouter({
        list: createProcedure().handler(() => ({ items: [] })),
        get: createProcedure()
          .input(createSingleStringFieldSchema("id"))
          .handler(({ input }) => ({ item: { id: input.id } })),
      });

      expect(router.list._type).toBe("procedure");
      expect(router.get._type).toBe("procedure");
    });
  });

  describe("createBunRPCRoutes", () => {
    test("generates routes from router", () => {
      const router = createRouter({
        list: createProcedure().handler(() => ({ items: [] })),
      });

      const rpc = createBunRPCRoutes({ items: router });

      expect(rpc.routes).toHaveProperty("/api/items/list");
    });

    test("handles nested routers", () => {
      const chatRouter = createRouter({
        list: createProcedure().handler(() => ({ chats: [] })),
      });
      const userRouter = createRouter({
        me: createProcedure().handler(() => ({ user: null })),
      });

      const rpc = createBunRPCRoutes({ chat: chatRouter, user: userRouter });

      expect(rpc.routes).toHaveProperty("/api/chat/list");
      expect(rpc.routes).toHaveProperty("/api/user/me");
    });

    test("custom prefix", () => {
      const router = createRouter({
        list: createProcedure().handler(() => ({ items: [] })),
      });

      const rpc = createBunRPCRoutes({ items: router }, { prefix: "/rpc" });

      expect(rpc.routes).toHaveProperty("/rpc/items/list");
    });
  });

  describe("createClient", () => {
    test("makes POST request to correct path", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ items: [] }), { status: 200 })
        )
      );

      const itemsRouter = createRouter({
        list: createProcedure().handler(() => ({
          items: [] as Array<{ id: string }>,
        })),
      });

      // Client needs the router type
      const client = createClient<{ items: typeof itemsRouter }>({
        baseUrl: "/api",
        fetch: mockFetch,
      });

      await client.items.list();

      expect(mockFetch).toHaveBeenCalledWith("/api/items/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    });

    test("sends input as JSON body", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ item: { id: "123" } }), { status: 200 })
        )
      );

      const itemsRouter = createRouter({
        get: createProcedure()
          .input(createSingleStringFieldSchema("id"))
          .handler(({ input }) => ({ item: { id: input.id } })),
      });

      const client = createClient<{ items: typeof itemsRouter }>({
        baseUrl: "/api",
        fetch: mockFetch,
      });

      await client.items.get({ id: "123" });

      expect(mockFetch).toHaveBeenCalledWith("/api/items/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "123" }),
      });
    });

    test("handles nested routes", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ chats: [] }), { status: 200 })
        )
      );

      const chatRouter = createRouter({
        list: createProcedure().handler(() => ({
          chats: [] as Array<{ id: string }>,
        })),
      });

      const client = createClient<{ chat: typeof chatRouter }>({
        baseUrl: "/api",
        fetch: mockFetch,
      });

      await client.chat.list();

      expect(mockFetch).toHaveBeenCalledWith("/api/chat/list", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    });

    test("uses custom headers", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      );

      const apiRouter = createRouter({
        test: createProcedure().handler(() => ({})),
      });

      const client = createClient<{ api: typeof apiRouter }>({
        fetch: mockFetch,
        headers: { Authorization: "Bearer token" },
      });

      await client.api.test();

      expect(mockFetch).toHaveBeenCalledWith("/api/api/test", {
        method: "POST",
        headers: {
          Authorization: "Bearer token",
          "Content-Type": "application/json",
        },
      });
    });
  });
});
