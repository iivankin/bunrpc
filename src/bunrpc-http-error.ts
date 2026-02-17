interface BunRpcHttpErrorOptions {
  source?: "app" | "system";
  code?: string;
}

interface BunRpcHttpErrorPayload {
  source: "app" | "system";
  code: string;
  status: number;
  message: string;
  details?: unknown;
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

  formatForLog(): string {
    if (this.details === undefined) {
      return `[${this.code}] ${this.message}`;
    }

    try {
      return `[${this.code}] ${this.message}: ${JSON.stringify(this.details)}`;
    } catch {
      return `[${this.code}] ${this.message}`;
    }
  }
}
