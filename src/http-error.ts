export class HttpError extends Error {
  status: number;
  details?: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }

  toJSON(): { error: string; details?: unknown } {
    return this.details === undefined
      ? { error: this.message }
      : { error: this.message, details: this.details };
  }

  formatForLog(): string {
    if (this.details === undefined) {
      return this.message;
    }

    try {
      return `${this.message}: ${JSON.stringify(this.details)}`;
    } catch {
      return this.message;
    }
  }
}
