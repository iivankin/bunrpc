interface HttpErrorOptions {
  source?: "app" | "system";
  code?: string;
}

interface HttpErrorPayload {
  source: "app" | "system";
  code: string;
  status: number;
  message: string;
  details?: unknown;
}

export class HttpError extends Error {
  status: number;
  details?: unknown;
  code: string;
  source: "app" | "system";

  constructor(
    status: number,
    message: string,
    details?: unknown,
    options: HttpErrorOptions = {}
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
    this.source = options.source ?? "system";
    this.code = options.code ?? (this.source === "app" ? "APP_ERROR" : "HTTP_ERROR");
  }

  toJSON(): HttpErrorPayload {
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
