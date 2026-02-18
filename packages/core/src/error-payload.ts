import {
  createSystemError,
  type AppRpcError,
  type RpcErrorUnion,
  type ValidationErrorDetails,
  type ValidationIssue,
  type SystemRpcError,
  type SystemRpcErrorCode,
} from "./types";

interface RpcErrorPayload {
  source?: unknown;
  code?: unknown;
  status?: unknown;
  message?: unknown;
  error?: unknown;
  details?: unknown;
}

const SYSTEM_ERROR_CODES = new Set<SystemRpcErrorCode>([
  "METHOD_NOT_ALLOWED",
  "INVALID_JSON",
  "VALIDATION_ERROR",
  "HTTP_ERROR",
  "INTERNAL_SERVER_ERROR",
  "NETWORK_ERROR",
  "BAD_RESPONSE",
]);

function isSystemErrorCode(code: string): code is SystemRpcErrorCode {
  return SYSTEM_ERROR_CODES.has(code as SystemRpcErrorCode);
}

function resolveMessage(data: RpcErrorPayload, fallbackMessage: string): string {
  if (typeof data.message === "string") {
    return data.message;
  }

  if (typeof data.error === "string") {
    return data.error;
  }

  return fallbackMessage;
}

function resolveStatus(data: RpcErrorPayload, fallbackStatus: number): number {
  return typeof data.status === "number" ? data.status : fallbackStatus;
}

function withDetails<TError extends RpcErrorUnion>(
  error: TError,
  details: unknown
): TError {
  return details === undefined ? error : { ...error, details };
}

function normalizeIssuePath(path: unknown): string {
  if (Array.isArray(path)) {
    if (path.length === 0) {
      return "(root)";
    }

    return path
      .map((segment) => {
        if (
          typeof segment === "object" &&
          segment !== null &&
          "key" in segment
        ) {
          return String((segment as { key: unknown }).key);
        }

        return String(segment);
      })
      .join(".");
  }

  if (typeof path === "string") {
    return path;
  }

  return "(root)";
}

function normalizeValidationIssue(issue: unknown): ValidationIssue | null {
  if (typeof issue !== "object" || issue === null) {
    return null;
  }

  const data = issue as { path?: unknown; message?: unknown };
  const message =
    typeof data.message === "string" ? data.message : "Validation issue";

  return {
    path: normalizeIssuePath(data.path),
    message,
  };
}

function normalizeValidationDetails(details: unknown): ValidationErrorDetails {
  const rawIssues =
    typeof details === "object" &&
    details !== null &&
    "issues" in details &&
    Array.isArray((details as { issues?: unknown }).issues)
      ? (details as { issues: unknown[] }).issues
      : [];

  const issues = rawIssues
    .map(normalizeValidationIssue)
    .filter((issue): issue is ValidationIssue => issue !== null);

  return { issues };
}

function createParsedAppError(
  code: string,
  status: number,
  message: string | undefined,
  details: unknown
): AppRpcError {
  const appError: AppRpcError =
    message === undefined
      ? {
          source: "app",
          code,
          status,
        }
      : {
          source: "app",
          code,
          status,
          message,
        };

  return withDetails(appError, details);
}

function createParsedSystemError(
  code: SystemRpcErrorCode,
  status: number,
  message: string,
  details: unknown
): SystemRpcError {
  if (code === "VALIDATION_ERROR") {
    return createSystemError(
      "VALIDATION_ERROR",
      status,
      message,
      normalizeValidationDetails(details)
    );
  }

  return createSystemError(code, status, message, details);
}

export function parseErrorPayload(
  payload: unknown,
  fallback: SystemRpcError
): RpcErrorUnion {
  if (typeof payload !== "object" || payload === null) {
    return fallback;
  }

  const data = payload as RpcErrorPayload;
  const code = typeof data.code === "string" ? data.code : undefined;
  const status = resolveStatus(data, fallback.status);
  const message = resolveMessage(data, fallback.message);
  const appMessage =
    typeof data.message === "string"
      ? data.message
      : typeof data.error === "string"
        ? data.error
        : undefined;
  const details = data.details;

  if (data.source === "app" && code) {
    return createParsedAppError(code, status, appMessage, details);
  }

  if (data.source === "system" && code && isSystemErrorCode(code)) {
    return createParsedSystemError(code, status, message, details);
  }

  if (!data.source && code && !isSystemErrorCode(code)) {
    return createParsedAppError(code, status, appMessage, details);
  }

  if (code && isSystemErrorCode(code)) {
    return createParsedSystemError(code, status, message, details);
  }

  return createSystemError(
    fallback.code,
    status,
    message,
    details ?? fallback.details
  );
}
