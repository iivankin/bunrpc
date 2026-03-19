interface BunRpcHttpErrorOptions {
  code?: string;
  source?: "app" | "system";
}

interface BunRpcHttpErrorPayload {
  code: string;
  details?: unknown;
  message: string;
  source: "app" | "system";
  status: number;
}

export class BunRpcHttpError extends Error {
  status: number;
  details?: unknown;
  code: string;
  source: "app" | "system";

  constructor(
    status: number,
    message: string,
    details?: unknown,
    options: BunRpcHttpErrorOptions = {}
  ) {
    super(message);
    this.name = "BunRpcHttpError";
    this.status = status;
    this.details = details;
    this.source = options.source ?? "system";
    this.code =
      options.code ?? (this.source === "app" ? "APP_ERROR" : "HTTP_ERROR");
  }

  toJSON(): BunRpcHttpErrorPayload {
    return this.details === undefined
      ? {
          source: this.source,
          code: this.code,
          status: this.status,
          message: this.message,
        }
      : {
          source: this.source,
          code: this.code,
          status: this.status,
          message: this.message,
          details: this.details,
        };
  }
}
