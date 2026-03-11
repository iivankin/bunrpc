// Core API exports
export type { ClientConfig, RpcError } from "./client";
export { createClient, createRpcError, isRpcError } from "./client";
export { definePlugin, useRouterPlugin } from "./plugin";
export {
  createBunRPCRoutes,
  createProcedure,
  createRouter,
} from "./server";
export type {
  BunRPCRouteErrorEvent,
  CreateBunRPCRoutesOptions,
  CreateRouterOptions,
} from "./server";

// Common type exports
export type {
  AppRpcError,
  BunRPCPlugin,
  BunRPCPluginDefinition,
  BunRPCPluginProcedureInfo,
  BunRPCPluginProcedureMethods,
  BunRPCPluginSetupContext,
  BunRPCPluginSetupResult,
  BunRPCRouteHandler,
  ClientRequestOptions,
  InferClient,
  InferSchema,
  InferSchemaInput,
  InferSchemaOutput,
  PluginExtension,
  PluginProcedureMeta,
  PluginRouterOptions,
  ProcedurePluginEntry,
  ProcedurePluginUse,
  RpcResult,
  RouterPluginExtensions,
  RouterPluginUse,
  SystemRpcError,
  SystemRpcErrorCode,
  ValidationErrorDetails,
  ValidationIssue,
} from "./types";
export { isAppError, isValidationError } from "./types";
export type { StandardSchemaV1 } from "./standard-schema";
