import type { BunRequest } from "bun";
import { describe, expect, mock, test } from "bun:test";
import {
  createBunRPCRoutes,
  createClient,
  createProcedure,
  createRouter,
  definePlugin,
  isAppError,
  isValidationError,
  useRouterPlugin,
} from "./index";
import type { ClientRequestOptions, StandardSchemaV1 } from "./types";

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

async function withMockedConsole<T>(
  run: (mocks: {
    groupCollapsed: ReturnType<typeof mock>;
    groupEnd: ReturnType<typeof mock>;
    log: ReturnType<typeof mock>;
  }) => Promise<T> | T
): Promise<T> {
  const originalGroupCollapsed = console.groupCollapsed;
  const originalGroupEnd = console.groupEnd;
  const originalLog = console.log;
  const groupCollapsed = mock(() => {});
  const groupEnd = mock(() => {});
  const log = mock(() => {});

  console.groupCollapsed = groupCollapsed as typeof console.groupCollapsed;
  console.groupEnd = groupEnd as typeof console.groupEnd;
  console.log = log as typeof console.log;

  try {
    return await run({ groupCollapsed, groupEnd, log });
  } finally {
    console.groupCollapsed = originalGroupCollapsed;
    console.groupEnd = originalGroupEnd;
    console.log = originalLog;
  }
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

    test("supports output schema contracts", () => {
      const outputSchema = createSingleStringFieldSchema("id");
      const createProcedureWithOutput = createProcedure()
        .output(outputSchema)
        .handler(() => ({ id: "chat_1" }));
      const createWithInputAndOutput = createProcedure()
        .input(createSingleStringFieldSchema("title"))
        .output(outputSchema)
        .handler(({ input }) => ({ id: input.title }));

      const client = createClient<{
        chat: {
          create: typeof createWithInputAndOutput;
        };
      }>();
      type CreateResult = Awaited<ReturnType<typeof client.chat.create>>;
      type CreateData = Extract<CreateResult, { ok: true }>["data"];
      const assertOutput: Expect<
        Equal<typeof createProcedureWithOutput._output, { id: string }>
      > = true;
      const assertClientOutput: Expect<Equal<CreateData, { id: string }>> = true;

      expect(assertOutput).toBe(true);
      expect(assertClientOutput).toBe(true);
      expect(createProcedureWithOutput.outputSchema).toBe(outputSchema);
      expect(createWithInputAndOutput.outputSchema).toBe(outputSchema);
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
      type MeClientParams = Parameters<typeof typedClient.user.me>;
      type ExpectedMeClientParams = [
        input?: undefined,
        requestOptions?: ClientRequestOptions,
      ];
      type MeClientError = Extract<MeClientResult, { ok: false }>["error"];
      type MeClientAppCode = Extract<
        MeClientError,
        { source: "app"; code: unknown }
      >["code"];
      const assertClientAppCode: Expect<
        Equal<MeClientAppCode, "UNAUTHORIZED">
      > = true;
      const assertClientParams: Expect<
        Equal<MeClientParams, ExpectedMeClientParams>
      > = true;
      expect(assertClientAppCode).toBe(true);
      expect(assertClientParams).toBe(true);

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

    test("supports typed openapi-style plugins", async () => {
      const openapiPlugin = definePlugin<
        "openapi",
        {
          description: (description: string) => {
            description: string;
          };
        },
        { documentPath: string },
        {
          document: {
            prefix: string;
            path: string;
            descriptions: string[];
            paths: string[];
          };
        }
      >({
        name: "openapi",
        procedure: {
          description: (description) => ({
            description,
          }),
        },
        setup: ({ options, prefix, procedures }) => {
          const document = {
            prefix,
            path: options.documentPath,
            descriptions: procedures.map(
              (procedure) => procedure.meta?.description ?? procedure.path
            ),
            paths: procedures.map((procedure) => procedure.fullPath),
          };

          return {
            extension: {
              document,
            },
            routes: {
              [options.documentPath]: () => Response.json(document),
            },
          };
        },
      });

      const publicProcedure = createProcedure().use(openapiPlugin());
      type DescriptionArgs = Parameters<typeof publicProcedure.description>;
      const assertDescriptionArgs: Expect<
        Equal<DescriptionArgs, [description: string]>
      > = true;
      const createProcedureWithDescription = publicProcedure
        .input(createSingleStringFieldSchema("title"))
        .description("Create chat")
        .handler(({ input }) => ({ title: input.title }));

      const chatRouter = createRouter(
        {
          list: publicProcedure
            .description("List chats")
            .handler(() => ({ items: [] as string[] })),
        },
        {
          plugins: [
            useRouterPlugin(openapiPlugin, {
              documentPath: "/openapi.json",
            }),
          ],
        }
      );

      const rpc = createBunRPCRoutes({ chat: chatRouter });

      type OpenApiDocument = typeof rpc.plugins.openapi.document;
      const assertDocument: Expect<
        Equal<
          OpenApiDocument,
          {
            prefix: string;
            path: string;
            descriptions: string[];
            paths: string[];
          }
        >
      > = true;

      expect(assertDescriptionArgs).toBe(true);
      expect(assertDocument).toBe(true);
      expect(createProcedureWithDescription._type).toBe("procedure");

      const response = await rpc.routes["/openapi.json"]!(
        new Request("http://localhost/openapi.json", {
          method: "GET",
        }) as BunRequest<string>,
        {} as never
      );
      const payload = (await response.json()) as {
        prefix: string;
        path: string;
        descriptions: string[];
        paths: string[];
      };

      expect(payload).toEqual({
        prefix: "/api",
        path: "/openapi.json",
        descriptions: ["List chats"],
        paths: ["/api/chat/list"],
      });
      expect(rpc.plugins.openapi.document).toEqual(payload);
    });

    test("supports typed mcp-style plugins on nested routers", async () => {
      const mcpPlugin = definePlugin<
        "mcp",
        {
          tool: (tool: string) => {
            tool: string;
          };
        },
        { manifestPath: string },
        {
          manifest: {
            tools: Array<{ name: string; path: string }>;
          };
        }
      >({
        name: "mcp",
        procedure: {
          tool: (tool) => ({
            tool,
          }),
        },
        setup: ({ options, procedures }) => {
          const tools = procedures
            .filter(
              (procedure): procedure is typeof procedure & {
                meta: { tool: string };
              } => procedure.meta !== undefined
            )
            .map((procedure) => ({
              name: procedure.meta.tool,
              path: procedure.fullPath,
            }));

          return {
            extension: {
              manifest: {
                tools,
              },
            },
            routes: {
              [options.manifestPath]: () => Response.json({ tools }),
            },
          };
        },
      });

      const mcpProcedure = createProcedure().use(mcpPlugin());

      const toolsRouter = createRouter(
        {
          echo: mcpProcedure
            .tool("echo")
            .handler(() => ({ ok: true })),
        },
        {
          plugins: [
            useRouterPlugin(mcpPlugin, {
              manifestPath: "/mcp/tools",
            }),
          ],
        }
      );

      const rpc = createBunRPCRoutes({
        tools: toolsRouter,
      });

      type McpTools = typeof rpc.plugins.mcp.manifest.tools;
      const assertTools: Expect<
        Equal<McpTools, Array<{ name: string; path: string }>>
      > = true;

      expect(assertTools).toBe(true);

      const response = await rpc.routes["/mcp/tools"]!(
        new Request("http://localhost/mcp/tools", {
          method: "GET",
        }) as BunRequest<string>,
        {} as never
      );
      const payload = (await response.json()) as {
        tools: Array<{ name: string; path: string }>;
      };

      expect(payload).toEqual({
        tools: [
          {
            name: "echo",
            path: "/api/tools/echo",
          },
        ],
      });
      expect(rpc.plugins.mcp.manifest).toEqual(payload);
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
        log: false,
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
        log: false,
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
        log: false,
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
        log: false,
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
        log: false,
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
        log: false,
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
        log: false,
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

    test("supports per-request headers and abort signal", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
      );
      const controller = new AbortController();

      const apiRouter = createRouter({
        test: createProcedure().handler(() => ({})),
      });

      const client = createClient<{ api: typeof apiRouter }>({
        fetch: mockFetch,
        headers: {
          Authorization: "Bearer global",
          "X-Global": "1",
        },
        log: false,
      });

      await client.api.test(undefined, {
        headers: {
          Authorization: "Bearer request",
          "X-Request": "2",
        },
        signal: controller.signal,
      });

      expect(mockFetch).toHaveBeenCalledWith("/api/api/test", {
        method: "POST",
        headers: {
          Authorization: "Bearer request",
          "X-Global": "1",
          "X-Request": "2",
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
    });

    test("logs custom headers and skips undefined input", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(
          new Response(JSON.stringify({ items: [] }), { status: 200 })
        )
      );

      const itemsRouter = createRouter({
        list: createProcedure()
          .input(createSingleStringFieldSchema("cursor"))
          .handler(() => ({
            items: [] as Array<{ id: string }>,
          })),
      });

      await withMockedConsole(async ({ groupCollapsed, groupEnd, log }) => {
        const client = createClient<{ items: typeof itemsRouter }>({
          baseUrl: "/api",
          fetch: mockFetch,
          log: true,
          headers: {
            Authorization: "Bearer global",
          },
        });

        await client.items.list(
          { cursor: "cursor_1" },
          {
            headers: {
              "X-Request": "1",
            },
          }
        );

        expect(groupCollapsed).toHaveBeenCalled();
        expect(groupCollapsed.mock.calls).toHaveLength(2);
        expect(String(groupCollapsed.mock.calls[0]?.[0])).toContain("request");
        expect(String(groupCollapsed.mock.calls[1]?.[0])).toContain("response");
        expect(groupEnd.mock.calls).toHaveLength(2);
        expect(log.mock.calls).toContainEqual([
          "headers",
          {
            Authorization: "Bearer global",
            "X-Request": "1",
          },
        ]);
        expect(log.mock.calls).toContainEqual([
          "input",
          { cursor: "cursor_1" },
        ]);
        expect(log.mock.calls).toContainEqual(["response", { items: [] }]);
      });
    });

    test("enables logging by default outside production", async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";

      try {
        const mockFetch = mock(() =>
          Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        );
        const apiRouter = createRouter({
          ping: createProcedure().handler(() => ({ ok: true })),
        });

        await withMockedConsole(async ({ groupCollapsed, log }) => {
          const client = createClient<{ api: typeof apiRouter }>({
            baseUrl: "/api",
            fetch: mockFetch,
          });

          await client.api.ping();

          expect(groupCollapsed).not.toHaveBeenCalled();
          expect(log).toHaveBeenCalled();
          expect(
            log.mock.calls.some((call) =>
              String(call[0]).includes("[bunrpc]")
            )
          ).toBe(true);
        });
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    test("disables logging by default in production", async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      try {
        const mockFetch = mock(() =>
          Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
        );
        const apiRouter = createRouter({
          ping: createProcedure().handler(() => ({ ok: true })),
        });

        await withMockedConsole(async ({ groupCollapsed, log }) => {
          const client = createClient<{ api: typeof apiRouter }>({
            baseUrl: "/api",
            fetch: mockFetch,
          });

          await client.api.ping();

          expect(groupCollapsed).not.toHaveBeenCalled();
          expect(log).not.toHaveBeenCalled();
        });
      } finally {
        process.env.NODE_ENV = originalNodeEnv;
      }
    });

    test("does not log undefined input or empty request groups", async () => {
      const mockFetch = mock(() =>
        Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      );
      const apiRouter = createRouter({
        ping: createProcedure().handler(() => ({ ok: true })),
      });

      await withMockedConsole(async ({ groupCollapsed, groupEnd, log }) => {
        const client = createClient<{ api: typeof apiRouter }>({
          baseUrl: "/api",
          fetch: mockFetch,
          log: true,
        });

        await client.api.ping();

        expect(groupCollapsed).not.toHaveBeenCalled();
        expect(groupEnd).not.toHaveBeenCalled();
        expect(log.mock.calls).not.toContainEqual(["input", undefined]);
      });
    });
  });
});
