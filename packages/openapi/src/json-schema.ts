import type { StandardSchemaV1 } from "@bunrpc/core";
import type { OpenAPIReferenceObject } from "./openapi-types";

interface StandardSchemaWithJSONSchema extends StandardSchemaV1 {
  "~standard": StandardSchemaV1["~standard"] & {
    jsonSchema?: {
      input?: () => unknown;
      output?: () => unknown;
    };
  };
  toJSONSchema?: () => unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeJSONSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJSONSchema(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  const sanitizedSchema: Record<string, unknown> = {};

  for (const [key, entry] of Object.entries(value)) {
    if (key === "~standard" || key === "$schema") {
      continue;
    }

    sanitizedSchema[key] = sanitizeJSONSchema(entry);
  }

  return sanitizedSchema;
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
      ? (schemaWithJSONSchema["~standard"].jsonSchema?.output?.() ??
        schemaWithJSONSchema["~standard"].jsonSchema?.input?.())
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

export function extractInputJSONSchema(
  schema: StandardSchemaV1 | undefined
): unknown | undefined {
  return extractJSONSchema(schema, "input");
}

export function extractOutputJSONSchema(
  schema: StandardSchemaV1 | undefined
): unknown | undefined {
  return extractJSONSchema(schema, "output");
}

export function isReferenceObject(
  value: unknown
): value is OpenAPIReferenceObject {
  return isRecord(value) && typeof value.$ref === "string";
}
