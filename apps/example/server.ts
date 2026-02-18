import {
  createBunRPCRoutes,
  createProcedure,
  createRouter,
} from "@bunrpc/core";
import * as z from "zod";

const CreateChatSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
});

const chats: Array<{ id: string; title: string; ownerId: string }> = [];

const publicProcedure = createProcedure();

const authProcedure = publicProcedure.use(({ req, error, next }) => {
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

const chatRouter = createRouter({
  list: authProcedure.handler(({ userId }) => {
    return chats.filter((chat) => chat.ownerId === userId);
  }),

  create: authProcedure
    .input(CreateChatSchema)
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
});

const rpc = createBunRPCRoutes(
  { chat: chatRouter },
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

export type AppRouter = typeof rpc._router;
