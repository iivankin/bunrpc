// Core API exports
export type { ClientConfig } from "./client";
export { createClient, RpcError } from "./client";
export {
  createBunRPCRoutes,
  createProcedure,
  createRouter,
} from "./server";
export type {
  BunRPCRouteErrorEvent,
  CreateBunRPCRoutesOptions,
} from "./server";

// Common type exports
export type {
  AppRpcError,
  InferClient,
  InferSchema,
  InferSchemaInput,
  InferSchemaOutput,
  RpcResult,
  SystemRpcError,
  SystemRpcErrorCode,
  ValidationErrorDetails,
  ValidationIssue,
} from "./types";
export { isAppError, isValidationError } from "./types";
export type { StandardSchemaV1 } from "./standard-schema";
