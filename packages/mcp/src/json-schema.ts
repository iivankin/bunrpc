import type { StandardSchemaV1 } from "@bunrpc/core";
import type { JSONSchemaObject, StandardSchemaWithJSONSchema } from "./mcp-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeJSONSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJSONSchema(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const next: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "~standard" || key === "$schema") {
      continue;
    }

    next[key] = sanitizeJSONSchema(entry);
  }

  return next;
}

function extractJSONSchema(
  schema: StandardSchemaV1 | undefined,
  mode: "input" | "output"
): unknown | undefined {
  if (!schema) {
    return undefined;
  }

  const schemaWithJSONSchema = schema as StandardSchemaWithJSONSchema;
  const standardJSONSchema =
    mode === "output"
      ? schemaWithJSONSchema["~standard"].jsonSchema?.output?.() ??
        schemaWithJSONSchema["~standard"].jsonSchema?.input?.()
      : schemaWithJSONSchema["~standard"].jsonSchema?.input?.();

  if (standardJSONSchema !== undefined) {
    return sanitizeJSONSchema(standardJSONSchema);
  }

  const runtimeJSONSchema = schemaWithJSONSchema.toJSONSchema?.();
  if (runtimeJSONSchema !== undefined) {
    return sanitizeJSONSchema(runtimeJSONSchema);
  }

  return undefined;
}

export function extractObjectJSONSchema(
  schema: StandardSchemaV1 | undefined,
  mode: "input" | "output",
  procedurePath: string
): JSONSchemaObject {
  const jsonSchema = extractJSONSchema(schema, mode);

  if (!isRecord(jsonSchema)) {
    throw new Error(
      `MCP tool "${procedurePath}" requires .${mode}(schema) to expose JSON Schema via ~standard.jsonSchema.${mode}() or toJSONSchema()`
    );
  }

  if (jsonSchema.type !== "object") {
    throw new Error(
      `MCP tool "${procedurePath}" requires .${mode}(schema) to resolve to a JSON Schema object with type: "object"`
    );
  }

  return jsonSchema as JSONSchemaObject;
}

export function isJSONObject(value: unknown): value is Record<string, unknown> {
  return isRecord(value);
}
