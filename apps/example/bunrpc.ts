import { initBunRpc } from "@bunrpc/core";
import { mcp } from "@bunrpc/mcp";
import { openapi } from "@bunrpc/openapi";

const b = initBunRpc({
  prefix: "/api",
  formatInternalServerError: () => ({
    message: "Unexpected server error",
  }),
})
  .use(
    openapi({
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
    })
  )
  .use(
    mcp({
      path: "/mcp",
      instructions: "Use the available BunRPC tools.",
      server: {
        name: "bunrpc-example-mcp",
        version: "1.0.0",
      },
      auth: {
        type: "header",
        validate: (headers) => {
          const value = headers.get("authorization");
          if (!value) {
            return false;
          }

          const userId = value.replace(/^Bearer\s+/i, "") || "demo-user";
          return { userId };
        },
      },
    })
  );

export const { publicProcedure, router } = b;
