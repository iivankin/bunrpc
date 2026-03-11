import type { BunRequest } from "bun";
import { describe, expect, test } from "bun:test";
import { initBunRpc, type StandardSchemaV1 } from "@bunrpc/core";
import type { OpenAPIResponsesObject } from "./index";
import { openapi } from "./index";

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
      vendor: "bunrpc-openapi-test",
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

describe("@bunrpc/openapi", () => {
  test("generates document and swagger routes through initBunRpc().use(...)", async () => {
    const b = initBunRpc().use(
      openapi({
        info: {
          title: "Test API",
          version: "1.0.0",
        },
        documentPath: "/openapi.json",
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
            },
          },
        },
        swagger: {
          path: "/docs",
          title: "Test API Docs",
          persistAuthorization: true,
          displayOperationId: true,
          filter: true,
        },
      })
    );

    const publicProcedure = b.publicProcedure;
    const authProcedure = publicProcedure.security({ bearerAuth: [] });
    const chatOutputSchema = createSingleStringFieldSchema("id", "Chat");

    type DescriptionArgs = Parameters<typeof publicProcedure.description>;
    type ResponsesArgs = Parameters<typeof publicProcedure.responses>;
    const assertDescriptionArgs: Expect<
      Equal<DescriptionArgs, [description: string]>
    > = true;
    const assertResponsesArgs: Expect<
      Equal<ResponsesArgs, [responses: OpenAPIResponsesObject]>
    > = true;

    const chatRouter = b.router({
      list: authProcedure
        .summary("List chats")
        .description("Returns all chats")
        .handler(() => ({ items: [] as string[] })),
      create: authProcedure
        .input(createSingleStringFieldSchema("title"))
        .output(chatOutputSchema)
        .summary("Create chat")
        .responses({
          "201": {
            description: "Chat created",
          },
        })
        .handler(({ input }) => ({ id: input.title })),
      details: authProcedure
        .output(chatOutputSchema)
        .summary("Get chat")
        .handler(() => ({ id: "chat_1" })),
      publicInfo: publicProcedure
        .summary("Public info")
        .security()
        .handler(() => ({ ok: true })),
    });

    const rpc = b.createHttpRoutes(
      b.router({
        chat: chatRouter,
      })
    );
    const document = rpc.plugins.openapi.document;

    expect(assertDescriptionArgs).toBe(true);
    expect(assertResponsesArgs).toBe(true);

    expect(document.info).toEqual({
      title: "Test API",
      version: "1.0.0",
    });
    expect(document.components?.schemas).toMatchObject({
      Chat: {
        type: "object",
        required: ["id"],
        properties: {
          id: {
            type: "string",
          },
        },
        title: "Chat",
      },
    });
    expect(document.paths["/api/chat/list"]?.post).toMatchObject({
      operationId: "chat.list",
      summary: "List chats",
      description: "Returns all chats",
      tags: ["chat"],
    });
    expect(document.paths["/api/chat/create"]?.post?.requestBody).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            required: ["title"],
            properties: {
              title: {
                type: "string",
              },
            },
          },
        },
      },
    });
    expect(document.paths["/api/chat/create"]?.post?.responses).toEqual({
      "200": {
        description: "Successful response",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Chat",
            },
          },
        },
      },
      "201": {
        description: "Chat created",
      },
    });
    expect(document.paths["/api/chat/details"]?.post?.responses).toEqual({
      "200": {
        description: "Successful response",
        content: {
          "application/json": {
            schema: {
              $ref: "#/components/schemas/Chat",
            },
          },
        },
      },
    });
    expect(document.paths["/api/chat/list"]?.post?.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(document.paths["/api/chat/create"]?.post?.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(document.paths["/api/chat/publicInfo"]?.post?.security).toEqual([]);

    const documentResponse = await rpc.routes["/openapi.json"]!(
      new Request("http://localhost/openapi.json") as BunRequest<string>,
      {} as never
    );
    const documentPayload = await documentResponse.json();

    expect(documentPayload).toEqual(document);

    const swaggerResponse = await rpc.routes["/docs"]!(
      new Request("http://localhost/docs") as BunRequest<string>,
      {} as never
    );
    const swaggerHtml = await swaggerResponse.text();

    expect(swaggerResponse.headers.get("content-type")).toBe(
      "text/html; charset=utf-8"
    );
    expect(swaggerHtml).toContain("/openapi.json");
    expect(swaggerHtml).toContain("Test API Docs");
    expect(swaggerHtml).toContain("persistAuthorization");
  });
});
