import type { BunRequest } from "bun";
import { describe, expect, test } from "bun:test";
import type {
  BunRPCRouteHandler,
  InferClient,
  StandardSchemaV1,
} from "@bunrpc/core";
import { createHttpRoutes, initBunRpc } from "@bunrpc/core";
import type { MCPToolOptions } from "./index";
import { isMcpRequestContext, mcp } from "./index";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() =>
  T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

function createSingleStringFieldSchema<TKey extends string>(
  key: TKey,
  title?: string
): StandardSchemaV1<unknown, Record<TKey, string>> {
  return {
    "~standard": {
      version: 1,
      vendor: "bunrpc-mcp-test",
      jsonSchema: {
        input: () => ({
          type: "object",
          required: [key],
          properties: {
            [key]: {
              type: "string",
            },
          },
          ...(title === undefined ? {} : { title }),
        }),
        output: () => ({
          type: "object",
          required: [key],
          properties: {
            [key]: {
              type: "string",
            },
          },
          ...(title === undefined ? {} : { title }),
        }),
      },
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
  } as StandardSchemaV1<unknown, Record<TKey, string>> & {
    "~standard": StandardSchemaV1<unknown, Record<TKey, string>>["~standard"] & {
      jsonSchema: {
        input: () => unknown;
        output: () => unknown;
      };
    };
  };
}

function createObjectSchema<TOutput extends Record<string, string>>(
  shape: Record<keyof TOutput & string, "string">,
  title?: string
): StandardSchemaV1<unknown, TOutput> {
  return {
    "~standard": {
      version: 1,
      vendor: "bunrpc-mcp-test",
      jsonSchema: {
        input: () => ({
          type: "object",
          required: Object.keys(shape),
          properties: Object.fromEntries(
            Object.keys(shape).map((key) => [key, { type: "string" }])
          ),
          ...(title === undefined ? {} : { title }),
        }),
        output: () => ({
          type: "object",
          required: Object.keys(shape),
          properties: Object.fromEntries(
            Object.keys(shape).map((key) => [key, { type: "string" }])
          ),
          ...(title === undefined ? {} : { title }),
        }),
      },
      validate: (value: unknown) => {
        if (typeof value !== "object" || value === null) {
          return { issues: [{ message: "Expected object" }] };
        }

        for (const key of Object.keys(shape)) {
          if (typeof (value as Record<string, unknown>)[key] !== "string") {
            return {
              issues: [
                {
                  message: `Expected ${key} to be string`,
                  path: [key],
                },
              ],
            };
          }
        }

        return {
          value: value as TOutput,
        };
      },
    },
  } as StandardSchemaV1<unknown, TOutput> & {
    "~standard": StandardSchemaV1<unknown, TOutput>["~standard"] & {
      jsonSchema: {
        input: () => unknown;
        output: () => unknown;
      };
    };
  };
}

async function callRoute(
  route: BunRPCRouteHandler,
  body: unknown,
  init: {
    sessionId?: string;
    headers?: Record<string, string>;
  } = {}
): Promise<Response> {
  return route(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        ...(init.sessionId === undefined
          ? {}
          : {
              "mcp-session-id": init.sessionId,
            }),
        ...init.headers,
      },
      body: JSON.stringify(body),
    }) as BunRequest<string>,
    {} as never
  );
}

async function initializeSession(
  route: BunRPCRouteHandler,
  headers?: Record<string, string>
): Promise<string> {
  const initializeResponse = await callRoute(
    route,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "bunrpc-test-client",
          version: "1.0.0",
        },
      },
    },
    { headers }
  );

  expect(initializeResponse.status).toBe(200);
  const sessionId = initializeResponse.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();

  await callRoute(
    route,
    {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    },
    {
      sessionId: sessionId ?? undefined,
      headers,
    }
  );

  return sessionId as string;
}

describe("@bunrpc/mcp", () => {
  test("lists tools, generates snake_case names, and injects typed header auth context", async () => {
    const b = initBunRpc().use(
      mcp({
        path: "/mcp",
        server: {
          name: "bunrpc-mcp-test",
          version: "1.0.0",
        },
        instructions: "Use the available bunrpc tools.",
        auth: {
          type: "header",
          validate: (headers) => {
            const value = headers.get("x-user");
            if (!value) {
              return false;
            }

            return {
            userId: value,
            tenantId: "tenant_1",
            };
          },
        },
      })
    );

    const publicProcedure = b.publicProcedure;
    type ToolArgs = Parameters<typeof publicProcedure.tool>;
    const assertToolArgs: Expect<
      Equal<ToolArgs, [options?: string | MCPToolOptions | undefined]>
    > = true;

    const authProcedure = publicProcedure.use((ctx) => {
      if (
        !isMcpRequestContext(ctx) ||
        !ctx.mcp.auth ||
        ctx.mcp.auth.type !== "header"
      ) {
        return ctx.error({
          code: "UNAUTHORIZED",
          status: 401,
          message: "Expected MCP header auth context",
        });
      }

      const assertHeaderAuthData: Expect<
        Equal<
          typeof ctx.mcp.auth.data,
          { userId: string; tenantId: string }
        >
      > = true;
      expect(assertHeaderAuthData).toBe(true);

      return ctx.next({
        userId: ctx.mcp.auth.data.userId,
        tenantId: ctx.mcp.auth.data.tenantId,
      });
    });

    const router = b.router({
      docs: b.router({
        queryAll: authProcedure
          .input(createSingleStringFieldSchema("query", "DocsQueryInput"))
          .output(
            createObjectSchema<{
              query: string;
              userId: string;
              tenantId: string;
            }>(
              {
                query: "string",
                userId: "string",
                tenantId: "string",
              },
              "DocsQueryOutput"
            )
          )
          .tool({
            title: "Query all docs",
            description: "Searches the docs for the current tenant",
          })
          .handler(({ input, tenantId, userId }) => ({
            query: input.query,
            userId,
            tenantId,
          })),
      }),
    });

    const rpc = b.createHttpRoutes(router);
    expect(assertToolArgs).toBe(true);
    expect(rpc.plugins.mcp.tools).toEqual([
      {
        name: "docs_query_all",
        title: "Query all docs",
        description: "Searches the docs for the current tenant",
        path: "/api/docs/queryAll",
      },
    ]);

    const route = rpc.routes["/mcp"]!;
    const headers = { "x-user": "demo-user" };
    const sessionId = await initializeSession(route, headers);

    const listResponse = await callRoute(
      route,
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
      {
        sessionId,
        headers,
      }
    );

    expect(listResponse.status).toBe(200);
    const listPayload = (await listResponse.json()) as {
      result: {
        tools: Array<{
          name: string;
          title?: string;
          description?: string;
        }>;
      };
    };

    expect(listPayload.result.tools).toHaveLength(1);
    expect(listPayload.result.tools[0]).toMatchObject({
      name: "docs_query_all",
      title: "Query all docs",
      description: "Searches the docs for the current tenant",
    });

    const callResponse = await callRoute(
      route,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "docs_query_all",
          arguments: {
            query: "hello",
          },
        },
      },
      {
        sessionId,
        headers,
      }
    );

    expect(callResponse.status).toBe(200);
    const callPayload = (await callResponse.json()) as {
      result: {
        structuredContent?: Record<string, unknown>;
      };
    };

    expect(callPayload.result.structuredContent).toEqual({
      query: "hello",
      userId: "demo-user",
      tenantId: "tenant_1",
    });
  });

  test("returns OAuth challenges and protected resource metadata from the transport layer", async () => {
    const b = initBunRpc().use(
      mcp({
        path: "/mcp",
        auth: {
          type: "oauth",
          verifyAccessToken: (token) =>
            token === "valid-token"
              ? {
                  token,
                  clientId: "oauth-client",
                  scopes: ["tools:read"],
                }
              : null,
          requiredScopes: ["tools:read"],
          metadata: {
            authorization_servers: ["https://auth.example.com"],
            resource_name: "BunRPC MCP",
          },
        },
      })
    );

    const router = b.router({
      echo: b.router({
        run: b.publicProcedure
          .input(createSingleStringFieldSchema("message"))
          .output(createObjectSchema<{ message: string }>({ message: "string" }))
          .tool("echo")
          .handler(({ input }) => ({ message: input.message })),
      }),
    });

    const rpc = b.createHttpRoutes(router);

    const unauthorizedResponse = await callRoute(rpc.routes["/mcp"]!, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: {
          name: "bunrpc-test-client",
          version: "1.0.0",
        },
      },
    });

    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.headers.get("www-authenticate")).toContain(
      "resource_metadata="
    );

    const metadataResponse = await rpc.routes[
      "/.well-known/oauth-protected-resource/mcp"
    ]!(
      new Request("http://localhost/.well-known/oauth-protected-resource/mcp", {
        method: "GET",
      }) as BunRequest<string>,
      {} as never
    );

    expect(metadataResponse.status).toBe(200);
    const metadataPayload = (await metadataResponse.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
      resource_name: string;
    };

    expect(metadataPayload).toEqual({
      resource: "http://localhost/mcp",
      authorization_servers: ["https://auth.example.com"],
      scopes_supported: ["tools:read"],
      resource_name: "BunRPC MCP",
    });
  });

  test("supports query auth and injects typed query auth data into handlers", async () => {
    const b = initBunRpc().use(
      mcp({
        path: "/mcp",
        auth: {
          type: "query",
          validate: (searchParams) => {
            const value = searchParams.get("token");
            return value ? { apiTokenId: value } : false;
          },
        },
      })
    );

    const router = b.router({
      query: b.router({
        inspect: b.publicProcedure
          .input(createObjectSchema<{ noop: string }>({ noop: "string" }))
          .output(
            createObjectSchema<{
              apiTokenId: string;
              requestSource: string;
            }>({
              apiTokenId: "string",
              requestSource: "string",
            })
          )
          .tool()
          .handler((ctx) => {
            if (
              !isMcpRequestContext(ctx) ||
              !ctx.mcp.auth ||
              ctx.mcp.auth.type !== "query"
            ) {
              return ctx.error({
                code: "UNAUTHORIZED",
                status: 401,
                message: "Expected MCP query auth context",
              });
            }

            const assertQueryAuthData: Expect<
              Equal<typeof ctx.mcp.auth.data, { apiTokenId: string }>
            > = true;
            expect(assertQueryAuthData).toBe(true);

            return {
              apiTokenId: ctx.mcp.auth.data.apiTokenId,
              requestSource: ctx.requestSource,
            };
          }),
      }),
    });

    const rpc = b.createHttpRoutes(router);
    const route = rpc.routes["/mcp"]!;

    const initializeResponse = await route(
      new Request("http://localhost/mcp?token=query-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: {
              name: "bunrpc-test-client",
              version: "1.0.0",
            },
          },
        }),
      }) as BunRequest<string>,
      {} as never
    );

    expect(initializeResponse.status).toBe(200);
    const sessionId = initializeResponse.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    await route(
      new Request("http://localhost/mcp?token=query-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
          "mcp-session-id": sessionId as string,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      }) as BunRequest<string>,
      {} as never
    );

    const callResponse = await route(
      new Request("http://localhost/mcp?token=query-token", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": "2025-11-25",
          "mcp-session-id": sessionId as string,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: {
            name: "query_inspect",
            arguments: {
              noop: "ok",
            },
          },
        }),
      }) as BunRequest<string>,
      {} as never
    );

    expect(callResponse.status).toBe(200);
    const callPayload = (await callResponse.json()) as {
      result: {
        structuredContent?: Record<string, unknown>;
      };
    };

    expect(callPayload.result.structuredContent).toEqual({
      apiTokenId: "query-token",
      requestSource: "mcp",
    });
  });

  test("throws when a tool is missing input or output schema", () => {
    const b = initBunRpc().use(mcp());

    expect(() =>
      createHttpRoutes(
        b.router({
          broken: b.router({
            run: b.publicProcedure.tool().handler(() => ({ ok: true })),
          }),
        })
      )
    ).toThrow(
      'MCP tool "broken/run" must define .input(schema) before .handler(...)'
    );
  });

  test("does not expose mcpOnlyHandler procedures over regular HTTP routes", async () => {
    const b = initBunRpc().use(mcp());

    const router = b.router({
      docs: b.router({
        queryAll: b.publicProcedure
          .input(createSingleStringFieldSchema("query"))
          .output(createObjectSchema<{ query: string }>({ query: "string" }))
          .tool({
            title: "Query all docs",
          })
          .mcpOnlyHandler(({ input }) => ({
            query: input.query,
          })),
      }),
    });

    const rpc = b.createHttpRoutes(router);
    type ClientDocs = InferClient<typeof router>["docs"];
    const assertClientHidesMcpOnlyRoute: Expect<
      Equal<"queryAll" extends keyof ClientDocs ? true : false, false>
    > = true;

    expect(rpc.routes["/api/docs/queryAll"]).toBeUndefined();
    expect(assertClientHidesMcpOnlyRoute).toBe(true);
    expect(rpc.plugins.mcp.tools).toEqual([
      {
        name: "docs_query_all",
        title: "Query all docs",
        description: undefined,
        path: "/api/docs/queryAll",
      },
    ]);

    const route = rpc.routes["/mcp"]!;
    const sessionId = await initializeSession(route);

    const callResponse = await callRoute(
      route,
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "docs_query_all",
          arguments: {
            query: "hidden",
          },
        },
      },
      {
        sessionId,
      }
    );

    expect(callResponse.status).toBe(200);
    const callPayload = (await callResponse.json()) as {
      result: {
        structuredContent?: Record<string, unknown>;
      };
    };

    expect(callPayload.result.structuredContent).toEqual({
      query: "hidden",
    });
  });

  test("throws when mcpOnlyHandler is used without .tool()", () => {
    const b = initBunRpc().use(mcp());

    expect(() =>
      createHttpRoutes(
        b.router({
          broken: b.router({
            run: b.publicProcedure
              .input(createObjectSchema<{ noop: string }>({ noop: "string" }))
              .output(createObjectSchema<{ ok: string }>({ ok: "string" }))
              .mcpOnlyHandler(() => ({ ok: "true" })),
          }),
        })
      )
    ).toThrow(
      'MCP-only procedure "broken/run" must define .tool(...) before .mcpOnlyHandler(...)'
    );
  });
});
