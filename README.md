# bunrpc monorepo

Monorepo for the `bunrpc` packages and example app.

## Packages

- `packages/core` -> `@bunrpc/core`, the Bun-first RPC core
- `packages/react` -> `@bunrpc/react`, TanStack Query integration
- `packages/openapi` -> `@bunrpc/openapi`, OpenAPI document and Swagger UI plugin
- `packages/mcp` -> `@bunrpc/mcp`, MCP transport/plugin for bunrpc procedures
- `apps/example` -> local playground app that wires all packages together

## Package documentation

- [`@bunrpc/core`](./packages/core/README.md)
- [`@bunrpc/react`](./packages/react/README.md)
- [`@bunrpc/openapi`](./packages/openapi/README.md)
- [`@bunrpc/mcp`](./packages/mcp/README.md)

## Install

```bash
bun install
```

## Validate workspaces

```bash
bun run check
bun run typecheck
bun run test
```

## Run example API

```bash
bun --cwd apps/example run server
```

The example server starts on `http://localhost:3000` and exposes:

- `GET /health`
- RPC routes under `/api/*`
- OpenAPI document at `/openapi.json`
- Swagger UI at `/docs`
- MCP endpoint at `/mcp`

## Publish packages

```bash
bun --cwd packages/core publish --access public
bun --cwd packages/react publish --access public
bun --cwd packages/openapi publish --access public
bun --cwd packages/mcp publish --access public
```

The `apps` directory is for local example and demo apps.
