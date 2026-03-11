import {
  createBunRPCRoutes,
  createProcedure,
  createRouter,
  useRouterPlugin,
} from "@bunrpc/core";
import { createOpenAPIPlugin } from "@bunrpc/openapi";
import * as z from "zod";

const CreateChatSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
}).meta({ title: "CreateChatInput" });

const ChatSchema = z.object({
  id: z.string(),
  title: z.string(),
  ownerId: z.string(),
}).meta({ title: "Chat" });

const ChatListSchema = z.array(ChatSchema).meta({ title: "ChatList" });

const AuthTokenSchema = z.object({
  token: z.string(),
  authorizationHeader: z.string(),
}).meta({ title: "AuthToken" });

const chats: Array<{ id: string; title: string; ownerId: string }> = [];

const openapi = createOpenAPIPlugin();
const publicProcedure = createProcedure().use(openapi());

const authProcedure = publicProcedure
  .security({ bearerAuth: [] })
  .use(({ req, error, next }) => {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return error({
        code: "UNAUTHORIZED",
        status: 401,
        message: "Authorization header is required",
      });
    }

    const userId = authHeader.replace(/^Bearer\s+/i, "") || "demo-user";
    return next({ userId });
  });

const authRouter = createRouter({
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

const chatRouter = createRouter(
  {
    list: authProcedure
      .summary("List chats")
      .output(ChatListSchema)
      .responses({
        "200": {
          description: "Chats for the current user",
        },
      })
      .handler(({ userId }) => {
        return chats.filter((chat) => chat.ownerId === userId);
      }),

    create: authProcedure
      .input(CreateChatSchema)
      .output(ChatSchema)
      .summary("Create chat")
      .description("Creates a chat for the current user")
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
  },
  {
    plugins: [
      useRouterPlugin(openapi, {
        info: {
          title: "BunRPC Example API",
          version: "1.0.0",
          description: "Example BunRPC server with generated OpenAPI docs",
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description:
                "Use `Bearer demo-user` for the example protected endpoints.",
            },
          },
        },
        documentPath: "/openapi.json",
        swagger: {
          path: "/docs",
          title: "BunRPC Example Docs",
          persistAuthorization: true,
          displayOperationId: true,
          filter: true,
        },
      }),
    ],
  }
);

const rpc = createBunRPCRoutes(
  { auth: authRouter, chat: chatRouter },
  {
    prefix: "/api",
    formatInternalServerError: () => ({
      message: "Unexpected server error",
    }),
  }
);

Bun.serve({
  port: 3000,
  routes: {
    "/health": () => Response.json({ ok: true }),
    ...rpc.routes,
  },
});

console.log("Example API server: http://localhost:3000");
console.log("Use Authorization header: Bearer demo-user");
console.log("OpenAPI document: http://localhost:3000/openapi.json");
console.log("Swagger UI: http://localhost:3000/docs");

export type AppRouter = typeof rpc._router;
