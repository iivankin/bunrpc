import type { BunRequest } from "bun";

export interface BunRPCRouteErrorEvent {
  duration: number;
  error?: string;
  method: string;
  path: string;
  req: BunRequest<string>;
  status: number;
}

export interface InitBunRpcOptions {
  formatInternalServerError?: (
    error: unknown,
    event: BunRPCRouteErrorEvent
  ) => {
    message?: string;
    details?: unknown;
  };
  prefix?: string;
}
