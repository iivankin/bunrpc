import { describe, expect, mock, test } from "bun:test";
import type { BunRequest } from "bun";
import {
  type AppRpcError,
  BUNRPC_CLIENT_REQUEST_META,
  type BunRPCPlugin,
  type ClientRequestOptions,
  createClient,
  createHttpRoutes,
  initBunRpc,
  isAppError,
  isValidationError,
  type RpcResult,
  type StandardSchemaV1,
  type SystemRpcError,
} from "./index";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Expect<T extends true> = T;

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

function withMockedConsole<T>(
  run: (mocks: {
    error: ReturnType<typeof mock>;
    log: ReturnType<typeof mock>;
  }) => Promise<T> | T
): Promise<T> {
  const originalError = console.error;
  const originalLog = console.log;
  const error = mock(() => {});
  const log = mock(() => {});

  console.error = error as typeof console.error;
  console.log = log as typeof console.log;

  return Promise.resolve(run({ error, log })).finally(() => {
    console.error = originalError;
    console.log = originalLog;
  });
}

function createOpenApiTestPlugin(options: {
  documentPath: string;
}): BunRPCPlugin<
  "openapi",
  { documentPath: string },
  {
    description: (description: string) => { description: string };
  },
  { description?: string },
  {
    document: {
      path: string;
      descriptions: string[];
    };
  }
> {
  return {
    name: "openapi",
    options,
    methods: {
      description: (description) => ({ description }),
    },
    setup: ({ options: pluginOptions, procedures }) => {
      const document = {
        path: pluginOptions.documentPath,
        descriptions: procedures.map(
          (procedure) => procedure.meta?.description ?? procedure.path
        ),
      };

      return {
        extension: {
          document,
        },
        routes: {
          [pluginOptions.documentPath]: () => Response.json(document),
        },
      };
    },
  };
}

function createMcpTestPlugin(options: { manifestPath: string }): BunRPCPlugin<
  "mcp",
  { manifestPath: string },
  {
    tool: (tool: string) => { tool: string };
  },
  { tool?: string },
  {
    manifest: {
      tools: Array<{ name: string; path: string }>;
    };
  }
> {
  return {
    name: "mcp",
    options,
    methods: {
      tool: (tool) => ({ tool }),
    },
    setup: ({ options: pluginOptions, procedures }) => {
      const tools = procedures
        .filter(
          (
            procedure
          ): procedure is typeof procedure & {
            meta: { tool: string };
          } => procedure.meta?.tool !== undefined
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
          [pluginOptions.manifestPath]: () => Response.json({ tools }),
        },
      };
    },
  };
}

describe("@bunrpc/core", () => {
  test("builds typed procedures and routes through initBunRpc", async () => {
    const b = initBunRpc();
    const outputSchema = createSingleStringFieldSchema("id");
    const authProcedure = b.publicProcedure.use(({ req, error, next }) => {
      const authHeader = req.headers.get("authorization");
      if (!authHeader) {
        return error({
          code: "UNAUTHORIZED",
          status: 401,
          message: "Unauthorized",
        });
      }

      return next({ userId: authHeader.replace(/^Bearer\s+/i, "") });
    });

    const appRouter = b.router({
      chat: b.router({
        create: authProcedure
          .input(createSingleStringFieldSchema("title"))
          .output(outputSchema)
          .handler(({ input }) => ({ id: input.title })),
        me: authProcedure.handler(({ userId }) => ({ id: userId })),
      }),
    });

    type AppRouter = typeof appRouter;
    const client = createClient<AppRouter>();
    type CreateResult = Awaited<ReturnType<typeof client.chat.create>>;
    type CreateData = Extract<CreateResult, { ok: true }>["data"];
    type MeParams = Parameters<typeof client.chat.me>;
    const assertClientOutput: Expect<Equal<CreateData, { id: string }>> = true;
    const assertMeParams: Expect<
      Equal<
        MeParams,
        [input?: undefined, requestOptions?: ClientRequestOptions]
      >
    > = true;

    expect(assertClientOutput).toBe(true);
    expect(assertMeParams).toBe(true);

    const rpc = b.createHttpRoutes(appRouter);
    const okResponse = await rpc.routes["/api/chat/create"]!(
      new Request("http://localhost/api/chat/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer demo-user",
        },
        body: JSON.stringify({ title: "chat_1" }),
      }) as BunRequest<string>,
      {} as never
    );

    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({ id: "chat_1" });

    const unauthorizedResponse = await rpc.routes["/api/chat/me"]!(
      new Request("http://localhost/api/chat/me", {
        method: "POST",
      }) as BunRequest<string>,
      {} as never
    );

    expect(unauthorizedResponse.status).toBe(401);
    const unauthorizedPayload =
      (await unauthorizedResponse.json()) as AppRpcError;
    expect(
      isAppError({
        ok: false,
        error: unauthorizedPayload,
      } satisfies RpcResult<never, AppRpcError>)
    ).toBe(true);
  });

  test("returns validation errors from generated routes", async () => {
    const b = initBunRpc();
    const appRouter = b.router({
      chat: b.router({
        create: b.publicProcedure
          .input(createSingleStringFieldSchema("title"))
          .handler(({ input }) => ({ title: input.title })),
      }),
    });

    const rpc = b.createHttpRoutes(appRouter);
    const response = await rpc.routes["/api/chat/create"]!(
      new Request("http://localhost/api/chat/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ title: 123 }),
      }) as BunRequest<string>,
      {} as never
    );
    const payload =
      (await response.json()) as SystemRpcError<"VALIDATION_ERROR">;

    expect(response.status).toBe(400);
    expect(
      isValidationError({
        ok: false,
        error: payload,
      } satisfies RpcResult<never, SystemRpcError<"VALIDATION_ERROR">>)
    ).toBe(true);
  });

  test("passes through raw Response objects from handlers for direct HTTP streaming", async () => {
    const b = initBunRpc();
    const encoder = new TextEncoder();
    const appRouter = b.router({
      events: b.publicProcedure
        .use(({ next }) => next())
        .handler(() => {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode("event: message\ndata: hello\n\n")
              );
              controller.close();
            },
          });

          return new Response(stream, {
            status: 202,
            headers: {
              "cache-control": "no-cache",
              "content-type": "text/event-stream; charset=utf-8",
            },
          });
        }),
    });

    const rpc = b.createHttpRoutes(appRouter);
    const response = await rpc.routes["/api/events"]!(
      new Request("http://localhost/api/events", {
        method: "POST",
      }) as BunRequest<string>,
      {} as never
    );

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-type")).toBe(
      "text/event-stream; charset=utf-8"
    );
    expect(await response.text()).toBe("event: message\ndata: hello\n\n");
  });

  test("supports app-scoped plugins with typed procedure methods and router extensions", async () => {
    const b = initBunRpc()
      .use(createOpenApiTestPlugin({ documentPath: "/openapi.json" }))
      .use(createMcpTestPlugin({ manifestPath: "/mcp.json" }));

    type DescriptionArgs = Parameters<typeof b.publicProcedure.description>;
    type ToolArgs = Parameters<typeof b.publicProcedure.tool>;
    const assertDescriptionArgs: Expect<
      Equal<DescriptionArgs, [description: string]>
    > = true;
    const assertToolArgs: Expect<Equal<ToolArgs, [tool: string]>> = true;

    const appRouter = b.router({
      chat: b.router({
        list: b.publicProcedure
          .description("List chats")
          .handler(() => ({ ok: true })),
      }),
      tools: b.router({
        create: b.publicProcedure
          .tool("chat_create")
          .handler(() => ({ ok: true })),
      }),
    });

    const rpc = b.createHttpRoutes(appRouter);
    expect(assertDescriptionArgs).toBe(true);
    expect(assertToolArgs).toBe(true);
    expect(rpc.plugins.openapi.document).toEqual({
      path: "/openapi.json",
      descriptions: ["List chats", "tools/create"],
    });
    expect(rpc.plugins.mcp.manifest.tools).toEqual([
      {
        name: "chat_create",
        path: "/api/tools/create",
      },
    ]);

    const documentResponse = await rpc.routes["/openapi.json"]!(
      new Request("http://localhost/openapi.json") as BunRequest<string>,
      {} as never
    );
    expect(await documentResponse.json()).toEqual(rpc.plugins.openapi.document);
  });

  test("formats internal server errors at route generation time", async () => {
    const b = initBunRpc({
      formatInternalServerError: () => ({
        message: "Unexpected server error",
        details: {
          traceId: "trace_1",
        },
      }),
    });
    const rpc = createHttpRoutes(
      b.router({
        test: b.publicProcedure.handler(() => {
          throw new Error("boom");
        }),
      })
    );

    const response = await rpc.routes["/api/test"]!(
      new Request("http://localhost/api/test", {
        method: "POST",
      }) as BunRequest<string>,
      {} as never
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload).toMatchObject({
      source: "system",
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected server error",
      details: {
        traceId: "trace_1",
      },
    });
  });

  test("global createHttpRoutes requires a router created by initBunRpc().router(...)", () => {
    expect(() =>
      createHttpRoutes({
        ping: {
          _type: "procedure",
        },
      } as never)
    ).toThrow(
      "bunrpc router is missing app metadata. Create it with initBunRpc(...).router(...) before calling createHttpRoutes(...)"
    );
  });

  test("client logging uses tRPC-style labels and payloads", async () => {
    await withMockedConsole(async ({ error, log }) => {
      const fetchMock = mock(async () => Response.json({ ok: true }));
      const client = createClient<{
        ping: {
          _type: "procedure";
          _input: undefined;
          _output: { ok: boolean };
          _error: never;
        };
      }>({
        baseUrl: "http://localhost/api",
        fetch: fetchMock,
        log: true,
        headers: {
          authorization: "Bearer demo-user",
        },
      });

      const result = await client.ping(undefined, {
        headers: {
          "x-trace-id": "trace_1",
        },
        [BUNRPC_CLIENT_REQUEST_META]: {
          operationType: "query",
        },
      });

      expect(result).toEqual({
        ok: true,
        data: {
          ok: true,
        },
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledTimes(2);
      expect(error).not.toHaveBeenCalled();

      expect(String(log.mock.calls[0]?.[0])).toContain(">> query #1 ping");
      expect(log.mock.calls[0]?.[1]).toEqual({
        headers: {
          authorization: "Bearer demo-user",
          "x-trace-id": "trace_1",
        },
      });
      expect(String(log.mock.calls[1]?.[0])).toContain("<< query #1 ping");
      expect(log.mock.calls[1]?.[1]).toEqual({
        elapsedMs: expect.any(Number),
        headers: {
          authorization: "Bearer demo-user",
          "x-trace-id": "trace_1",
        },
        result: {
          ok: true,
        },
      });
    });
  });
});
