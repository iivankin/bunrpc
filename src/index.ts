// Server exports

export type { ClientConfig } from "./client";

// Client exports
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

// Type exports
export type {
  AppRpcError,
  AnyProcedure,
  BaseContext,
  BunRPCRoutes,
  InferClient,
  InferSchema,
  InferSchemaInput,
  InferSchemaOutput,
  ProcedureClientError,
  ProcedureResult,
  Procedure,
  RpcResult,
  ValidationErrorDetails,
  ValidationIssue,
  SystemRpcError,
  SystemErrorDetails,
  SystemRpcErrorCode,
  Router,
} from "./types";
export { isAppError } from "./types";
export type { StandardSchemaV1 } from "./standard-schema";
