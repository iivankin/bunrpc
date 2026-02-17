import type { BunRequest } from "bun";
import { describe, expect, mock, test } from "bun:test";
import {
  createBunRPCRoutes,
  createClient,
  createProcedure,
  createRouter,
  isAppError,
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

    test("supports middleware and handler error helpers", async () => {
      const authProcedure = createProcedure().use(({ error }) => {
        return error({
          code: "UNAUTHORIZED",
          status: 401,
          message: "Unauthorized",
        });
      });

      const rpc = createBunRPCRoutes({
        user: createRouter({
          me: authProcedure.handler(() => ({ id: "1" })),
        }),
      });

      const req = new Request("http://localhost/api/user/me", {
        method: "POST",
      }) as BunRequest<string>;

      const response = await rpc.routes["/api/user/me"]!(req, {} as never);
      const payload = await response.json();

      expect(response.status).toBe(401);
      expect(payload).toEqual({
        source: "app",
        code: "UNAUTHORIZED",
        status: 401,
        message: "Unauthorized",
      });
    });
  });

  describe("createRouter/createBunRPCRoutes", () => {
    test("generates routes from nested router", () => {
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

    test("respects custom prefix", () => {
      const router = createRouter({
        list: createProcedure().handler(() => ({ items: [] })),
      });

      const rpc = createBunRPCRoutes({ items: router }, { prefix: "/rpc" });

      expect(rpc.routes).toHaveProperty("/rpc/items/list");
    });
  });

  describe("createClient", () => {
    test("returns safe success result", async () => {
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

      const client = createClient<{ items: typeof itemsRouter }>({
        baseUrl: "/api",
        fetch: mockFetch,
      });

      const result = await client.items.list();

      expect(result).toEqual({ ok: true, data: { items: [] } });
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

      const result = await client.items.get({ id: "123" });

      expect(result).toEqual({ ok: true, data: { item: { id: "123" } } });
      expect(mockFetch).toHaveBeenCalledWith("/api/items/get", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "123" }),
      });
    });

    test("normalizes app errors", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              source: "app",
              code: "CHAT_LIMIT",
              status: 429,
              message: "Too many chats",
              details: { limit: 3 },
            }),
            { status: 429 }
          )
        )
      );

      const chatRouter = createRouter({
        create: createProcedure()
          .input(createSingleStringFieldSchema("title"))
          .handler(({ error, input }) => {
            if (input.title === "__never__") {
              return error({
                code: "CHAT_LIMIT",
                status: 429,
                message: "Too many chats",
                details: { limit: 3 },
              });
            }

            return { id: "1" };
          }),
      });

      const client = createClient<{ chat: typeof chatRouter }>({
        baseUrl: "/api",
        fetch: mockFetch,
      });

      const result = await client.chat.create({ title: "Roadmap" });

      expect(result.ok).toBe(false);
      if (isAppError(result)) {
        expect(result.error.code).toBe("CHAT_LIMIT");
        expect(result.error.details).toEqual({ limit: 3 });
      } else {
        throw new Error("Expected app error");
      }
    });

    test("returns network errors as safe system errors", async () => {
      const mockFetch = mock(() => Promise.reject(new Error("offline")));

      const apiRouter = createRouter({
        ping: createProcedure().handler(() => ({ ok: true })),
      });

      const client = createClient<{ api: typeof apiRouter }>({
        baseUrl: "/api",
        fetch: mockFetch,
      });

      const result = await client.api.ping();

      expect(result).toMatchObject({
        ok: false,
        error: {
          source: "system",
          code: "NETWORK_ERROR",
        },
      });
    });

    test("returns bad response when success body is not JSON", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response("not-json", { status: 200 }))
      );

      const apiRouter = createRouter({
        ping: createProcedure().handler(() => ({ ok: true })),
      });

      const client = createClient<{ api: typeof apiRouter }>({
        baseUrl: "/api",
        fetch: mockFetch,
      });

      const result = await client.api.ping();

      expect(result).toMatchObject({
        ok: false,
        error: {
          source: "system",
          code: "BAD_RESPONSE",
        },
      });
    });

    test("normalizes validation error details with typed issues", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              source: "system",
              code: "VALIDATION_ERROR",
              status: 400,
              message: "Validation failed",
              details: {
                issues: [
                  {
                    path: ["title"],
                    message: "Title is required",
                  },
                ],
              },
            }),
            { status: 400 }
          )
        )
      );

      const apiRouter = createRouter({
        create: createProcedure()
          .input(createSingleStringFieldSchema("title"))
          .handler(() => ({ ok: true })),
      });

      const client = createClient<{ api: typeof apiRouter }>({
        baseUrl: "/api",
        fetch: mockFetch,
      });

      const result = await client.api.create({ title: "" });

      expect(result.ok).toBe(false);
      if (!result.ok && result.error.code === "VALIDATION_ERROR") {
        expect(result.error.details.issues[0]).toEqual({
          path: "title",
          message: "Title is required",
        });
      }
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
