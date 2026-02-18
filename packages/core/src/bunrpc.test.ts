import type { BunRequest } from "bun";
import { describe, expect, mock, test } from "bun:test";
import {
  createBunRPCRoutes,
  createClient,
  createProcedure,
  createRouter,
  isAppError,
  isValidationError,
} from "./index";
import type { StandardSchemaV1 } from "./types";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() =>
  T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;
const NEVER_TRUE = false as boolean;

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
      const authProcedure = createProcedure().use(async ({ error, next }) => {
        if (NEVER_TRUE) {
          return next({ userId: "never" });
        }

        return error({
          code: "UNAUTHORIZED",
          status: 401,
          message: "Unauthorized",
        });
      });

      const meProcedure = authProcedure.handler(({ userId }) => ({ id: userId }));

      const typedClient = createClient<{
        user: {
          me: typeof meProcedure;
        };
      }>();
      type MeClientResult = Awaited<ReturnType<typeof typedClient.user.me>>;
      type MeClientError = Extract<MeClientResult, { ok: false }>["error"];
      type MeClientAppCode = Extract<
        MeClientError,
        { source: "app"; code: unknown }
      >["code"];
      const assertClientAppCode: Expect<
        Equal<MeClientAppCode, "UNAUTHORIZED">
      > = true;
      expect(assertClientAppCode).toBe(true);

      const assertControlFlowNarrowing = (
        result: MeClientResult
      ): "UNAUTHORIZED" | null => {
        if (!result.ok && result.error.source === "app") {
          const code: "UNAUTHORIZED" = result.error.code;
          return code;
        }

        return null;
      };
      expect(assertControlFlowNarrowing({
        ok: false,
        error: {
          source: "app",
          code: "UNAUTHORIZED",
          status: 401,
        },
      })).toBe("UNAUTHORIZED");

      const rpc = createBunRPCRoutes({
        user: createRouter({
          me: meProcedure,
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

    test("passes middleware context via next()", async () => {
      const authProcedure = createProcedure().use(async ({ next }) => {
        return next({ userId: "user_1" });
      });

      const rpc = createBunRPCRoutes({
        user: createRouter({
          me: authProcedure.handler(({ userId }) => ({ userId })),
        }),
      });

      const req = new Request("http://localhost/api/user/me", {
        method: "POST",
      }) as BunRequest<string>;

      const response = await rpc.routes["/api/user/me"]!(req, {} as never);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({ userId: "user_1" });
    });

    test("supports sync middleware with error/next branches", async () => {
      const authProcedure = createProcedure().use(({ req, error, next }) => {
        const authHeader = req.headers.get("authorization");
        if (!authHeader) {
          return error({
            code: "UNAUTHORIZED",
            status: 401,
          });
        }

        return next({ userId: authHeader });
      });

      const rpc = createBunRPCRoutes({
        user: createRouter({
          me: authProcedure.handler(({ userId }) => ({ userId })),
        }),
      });

      const unauthReq = new Request("http://localhost/api/user/me", {
        method: "POST",
      }) as BunRequest<string>;

      const unauthResponse = await rpc.routes["/api/user/me"]!(
        unauthReq,
        {} as never
      );
      const unauthPayload = await unauthResponse.json();

      expect(unauthResponse.status).toBe(401);
      expect(unauthPayload).toEqual({
        source: "app",
        code: "UNAUTHORIZED",
        status: 401,
      });

      const authReq = new Request("http://localhost/api/user/me", {
        method: "POST",
        headers: {
          authorization: "user_sync",
        },
      }) as BunRequest<string>;

      const authResponse = await rpc.routes["/api/user/me"]!(
        authReq,
        {} as never
      );
      const authPayload = await authResponse.json();

      expect(authResponse.status).toBe(200);
      expect(authPayload).toEqual({ userId: "user_sync" });
    });

    test("supports middleware next() timing pattern", async () => {
      const events: string[] = [];

      const publicProcedure = createProcedure();
      const loggedProcedure = publicProcedure.use(async (opts) => {
        const result = await opts.next();

        events.push(`${opts.path}:${opts.type}:${result.ok ? "ok" : "error"}`);
        return result;
      });

      const rpc = createBunRPCRoutes({
        ping: loggedProcedure.handler(() => ({ ok: true })),
      });

      const req = new Request("http://localhost/api/ping", {
        method: "POST",
      }) as BunRequest<string>;

      const response = await rpc.routes["/api/ping"]!(req, {} as never);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toEqual({ ok: true });
      expect(events).toEqual(["/api/ping:rpc:ok"]);
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

  describe("createBunRPCRoutes internal error formatter", () => {
    test("formats internal server error response", async () => {
      const rpc = createBunRPCRoutes(
        {
          test: createProcedure().handler(() => {
            throw new Error("sensitive details");
          }),
        },
        {
          formatInternalServerError: (_error, event) => ({
            message: "Something went wrong",
            details: { requestPath: event.path },
          }),
        }
      );

      const req = new Request("http://localhost/api/test", {
        method: "POST",
      }) as BunRequest<string>;

      const response = await rpc.routes["/api/test"]!(req, {} as never);
      const payload = await response.json();

      expect(response.status).toBe(500);
      expect(payload).toEqual({
        source: "system",
        code: "INTERNAL_SERVER_ERROR",
        status: 500,
        message: "Something went wrong",
        details: { requestPath: "/api/test" },
      });
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
      if (isValidationError(result)) {
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
