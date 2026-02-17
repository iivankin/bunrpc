interface RpcErrorPayload {
  error?: unknown;
  details?: unknown;
}

export function parseErrorPayload(
  payload: unknown,
  fallbackMessage: string
): { message: string; details?: unknown } {
  if (typeof payload !== "object" || payload === null) {
    return { message: fallbackMessage };
  }

  const data = payload as RpcErrorPayload;
  const message =
    typeof data.error === "string" ? data.error : fallbackMessage;

  return data.details === undefined
    ? { message }
    : { message, details: data.details };
}
