import type { StandardSchemaV1 } from "@bunrpc/core";
import { extractOutputJSONSchema, isRecord } from "./json-schema";
import type { OpenAPIPluginOptions } from "./openapi-types";

function sortJSONValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJSONValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, entry]) => [key, sortJSONValue(entry)])
  );
}

function createJSONSchemaSignature(value: unknown): string {
  return JSON.stringify(sortJSONValue(value));
}

function collectNamedSchemas(
  schema: unknown,
  candidates: Array<{ title: string; schema: Record<string, unknown> }>
): void {
  if (Array.isArray(schema)) {
    for (const item of schema) {
      collectNamedSchemas(item, candidates);
    }

    return;
  }

  if (!isRecord(schema)) {
    return;
  }

  if (typeof schema.title === "string" && schema.title.length > 0) {
    candidates.push({
      title: schema.title,
      schema,
    });
  }

  for (const entry of Object.values(schema)) {
    collectNamedSchemas(entry, candidates);
  }
}

function replaceNamedSchemasWithRefs(
  schema: unknown,
  reusableTitles: ReadonlySet<string>,
  currentComponentTitle?: string
): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) =>
      replaceNamedSchemasWithRefs(item, reusableTitles, currentComponentTitle)
    );
  }

  if (!isRecord(schema)) {
    return schema;
  }

  const schemaTitle =
    typeof schema.title === "string" ? schema.title : undefined;
  if (
    schemaTitle !== undefined &&
    reusableTitles.has(schemaTitle) &&
    schemaTitle !== currentComponentTitle
  ) {
    return {
      $ref: `#/components/schemas/${schemaTitle}`,
    };
  }

  return Object.fromEntries(
    Object.entries(schema).map(([key, entry]) => [
      key,
      replaceNamedSchemasWithRefs(entry, reusableTitles, currentComponentTitle),
    ])
  );
}

export function createOutputSchemaRegistry(
  procedures: Array<{
    fullPath: string;
    outputSchema?: StandardSchemaV1;
  }>,
  components: OpenAPIPluginOptions["components"] | undefined
): {
  componentsSchemas: NonNullable<OpenAPIPluginOptions["components"]>["schemas"];
  resolvedOutputSchemasByPath: Map<string, unknown>;
} {
  const existingSchemaNames = new Set(Object.keys(components?.schemas ?? {}));
  const extractedOutputSchemasByPath = new Map<string, unknown>();
  const candidatesByTitle = new Map<
    string,
    Array<{ schema: Record<string, unknown>; signature: string }>
  >();

  for (const procedure of procedures) {
    const outputSchema = extractOutputJSONSchema(procedure.outputSchema);
    if (outputSchema === undefined) {
      continue;
    }

    extractedOutputSchemasByPath.set(procedure.fullPath, outputSchema);

    const candidates: Array<{
      title: string;
      schema: Record<string, unknown>;
    }> = [];
    collectNamedSchemas(outputSchema, candidates);

    for (const candidate of candidates) {
      const titleCandidates = candidatesByTitle.get(candidate.title) ?? [];
      titleCandidates.push({
        schema: candidate.schema,
        signature: createJSONSchemaSignature(candidate.schema),
      });
      candidatesByTitle.set(candidate.title, titleCandidates);
    }
  }

  const reusableSchemas = new Map<string, Record<string, unknown>>();

  for (const [title, titleCandidates] of candidatesByTitle) {
    if (titleCandidates.length < 2 || existingSchemaNames.has(title)) {
      continue;
    }

    const [firstCandidate, ...restCandidates] = titleCandidates;
    if (!firstCandidate) {
      continue;
    }

    if (
      restCandidates.some(
        (candidate) => candidate.signature !== firstCandidate.signature
      )
    ) {
      continue;
    }

    reusableSchemas.set(title, firstCandidate.schema);
  }

  const reusableTitles = new Set(reusableSchemas.keys());
  const componentsSchemas = Object.fromEntries(
    Array.from(reusableSchemas.entries()).map(([title, schema]) => [
      title,
      replaceNamedSchemasWithRefs(schema, reusableTitles, title),
    ])
  ) as NonNullable<OpenAPIPluginOptions["components"]>["schemas"];

  const resolvedOutputSchemasByPath = new Map<string, unknown>();
  for (const [fullPath, schema] of extractedOutputSchemasByPath) {
    resolvedOutputSchemasByPath.set(
      fullPath,
      replaceNamedSchemasWithRefs(schema, reusableTitles)
    );
  }

  return {
    componentsSchemas,
    resolvedOutputSchemasByPath,
  };
}
