# brpc monorepo

Monorepo layout for Bun RPC packages.

## Workspace structure

- `packages/core` -> `@bunrpc/core`
- `packages/react` -> `@bunrpc/react`
- `apps/example` -> local playground app

## Install

```bash
bun install
```

## Validate all workspaces

```bash
bun run check
```

## Run example API

```bash
bun --cwd apps/example run server
```

## Publish packages

```bash
bun --cwd packages/core publish --access public
bun --cwd packages/react publish --access public
```

The `apps` folder is intended for example/demo apps now and docs site in the future.
