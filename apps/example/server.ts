import { createHttpRoutes } from "@bunrpc/core";
import { isMcpRequestContext } from "@bunrpc/mcp";
import * as z from "zod";
import { publicProcedure, router } from "./bunrpc";

const CreateChatSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required"),
  })
  .meta({ title: "CreateChatInput" });

const ChatSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    ownerId: z.string(),
  })
  .meta({ title: "Chat" });

const ChatListSchema = z.array(ChatSchema).meta({ title: "ChatList" });

const AuthTokenSchema = z
  .object({
    token: z.string(),
    authorizationHeader: z.string(),
  })
  .meta({ title: "AuthToken" });

const chats: Array<{ id: string; title: string; ownerId: string }> = [];

const authProcedure = publicProcedure
  .security({ bearerAuth: [] })
  .use((ctx) => {
    if (isMcpRequestContext(ctx) && ctx.mcp.auth?.type === "header") {
      return ctx.next({ userId: ctx.mcp.auth.data.userId });
    }

    const authHeader = ctx.req.headers.get("authorization");
    if (!authHeader) {
      return ctx.error({
        code: "UNAUTHORIZED",
        status: 401,
        message: "Authorization header is required",
      });
    }

    const userId = authHeader.replace(/^Bearer\s+/i, "") || "demo-user";
    return ctx.next({ userId });
  });

const authRouter = router({
  token: publicProcedure
    .summary("Get demo token")
    .description("Returns the demo bearer token for Swagger UI authorization")
    .security()
    .output(AuthTokenSchema)
    .responses({
      "200": {
        description: "Demo authorization payload",
      },
    })
    .handler(() => ({
      token: "demo-user",
      authorizationHeader: "Bearer demo-user",
    })),
});

const chatRouter = router({
  list: authProcedure
    .summary("List chats")
    .output(ChatListSchema)
    .responses({
      "200": {
        description: "Chats for the current user",
      },
    })
    .handler(({ userId }) => chats.filter((chat) => chat.ownerId === userId)),

  create: authProcedure
    .input(CreateChatSchema)
    .output(ChatSchema)
    .summary("Create chat")
    .description("Creates a chat for the current user")
    .tool({
      title: "Create Chat",
      description: "Creates a chat for the authenticated user",
    })
    .responses({
      "200": {
        description: "Created chat",
      },
      "400": {
        description: "Title is invalid",
      },
      "403": {
        description: "Title is forbidden",
      },
    })
    .handler(({ input, userId, error }) => {
      if (input.title.length > 40) {
        return error({
          code: "TITLE_TOO_LONG",
          status: 400,
          message: "Chat title must be at most 40 characters",
          details: { max: 40 },
        });
      }

      if (input.title.toLowerCase() === "forbidden") {
        return error({
          code: "TITLE_FORBIDDEN",
          status: 403,
          message: "This title is forbidden",
        });
      }

      const chat = {
        id: crypto.randomUUID(),
        title: input.title,
        ownerId: userId,
      };

      chats.push(chat);
      return chat;
    }),

  createViaMcp: authProcedure
    .input(CreateChatSchema)
    .output(ChatSchema)
    .tool({
      title: "Create Chat via MCP",
      description: "Creates a chat that is exposed only through the MCP tool transport",
    })
    .mcpOnlyHandler(({ input, userId, error }) => {
      if (input.title.length > 40) {
        return error({
          code: "TITLE_TOO_LONG",
          status: 400,
          message: "Chat title must be at most 40 characters",
          details: { max: 40 },
        });
      }

      const chat = {
        id: crypto.randomUUID(),
        title: `[mcp] ${input.title}`,
        ownerId: userId,
      };

      chats.push(chat);
      return chat;
    }),
});

const appRouter = router({
  auth: authRouter,
  chat: chatRouter,
});

const http = createHttpRoutes(appRouter);

Bun.serve({
  port: 3000,
  routes: {
    "/health": () => Response.json({ ok: true }),
    ...http.routes,
  },
});

console.log("Example API server: http://localhost:3000");
console.log("Use Authorization header: Bearer demo-user");
console.log("OpenAPI document: http://localhost:3000/openapi.json");
console.log("Swagger UI: http://localhost:3000/docs");
console.log("MCP endpoint: http://localhost:3000/mcp");
console.log("MCP-only tool: chat_create_via_mcp");

export type AppRouter = typeof appRouter;
