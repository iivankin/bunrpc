import { definePlugin } from "@bunrpc/core";
import type { BunRPCPlugin, StandardSchemaV1 } from "@bunrpc/core";
import type {
  OpenAPIObject,
  OpenAPIPathItemObject,
  OpenAPIPluginOptions,
  OpenAPIProcedureMeta,
  OpenAPIReferenceObject,
  OpenAPIRequestBodyObject,
  OpenAPIResponsesObject,
  OpenAPISecurityRequirementObject,
  SwaggerUIOptions,
} from "./openapi-types";

const DEFAULT_DOCUMENT_PATH = "/openapi.json";
const DEFAULT_SWAGGER_PATH = "/docs";
const DEFAULT_SWAGGER_ASSET_BASE =
  "https://unpkg.com/swagger-ui-dist@5.11.0";

interface StandardSchemaWithJSONSchema extends StandardSchemaV1 {
  "~standard": StandardSchemaV1["~standard"] & {
    jsonSchema?: {
      input?: () => unknown;
      output?: () => unknown;
    };
  };
  toJSONSchema?: () => unknown;
}

interface ResolvedSwaggerOptions extends Required<SwaggerUIOptions> {}

type OpenAPIProcedureMethods = {
  operationId: (operationId: string) => Pick<OpenAPIProcedureMeta, "operationId">;
  summary: (summary: string) => Pick<OpenAPIProcedureMeta, "summary">;
  description: (description: string) => Pick<OpenAPIProcedureMeta, "description">;
  tags: (...tags: string[]) => Pick<OpenAPIProcedureMeta, "tags">;
  deprecated: (
    deprecated?: boolean
  ) => Pick<OpenAPIProcedureMeta, "deprecated">;
  security: (
    ...security: OpenAPISecurityRequirementObject[]
  ) => Pick<OpenAPIProcedureMeta, "security">;
  requestBody: (
    requestBody: OpenAPIRequestBodyObject | OpenAPIReferenceObject
  ) => Pick<OpenAPIProcedureMeta, "requestBody">;
  responses: (
    responses: OpenAPIResponsesObject
  ) => Pick<OpenAPIProcedureMeta, "responses">;
};

export type {
  OpenAPIComponentsObject,
  OpenAPIHttpMethod,
  OpenAPIInfoObject,
  OpenAPIMediaTypeObject,
  OpenAPIObject,
  OpenAPIOperationObject,
  OpenAPIPathItemObject,
  OpenAPIPluginOptions,
  OpenAPIProcedureMeta,
  OpenAPIReferenceObject,
  OpenAPIRequestBodyObject,
  OpenAPIResponseObject,
  OpenAPIResponsesObject,
  OpenAPISchemaObject,
  OpenAPISecurityRequirementObject,
  OpenAPISecuritySchemeObject,
  OpenAPIServerObject,
  OpenAPITagObject,
  SwaggerUIOptions,
} from "./openapi-types";

function createDefaultRequestBody(): OpenAPIRequestBodyObject {
  return {
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          additionalProperties: true,
        },
      },
    },
  };
}

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

function extractInputJSONSchema(
  schema: StandardSchemaV1 | undefined
): unknown | undefined {
  return extractJSONSchema(schema, "input");
}

function extractOutputJSONSchema(
  schema: StandardSchemaV1 | undefined
): unknown | undefined {
  return extractJSONSchema(schema, "output");
}

function createDefaultSuccessResponse(
  outputSchema: unknown | undefined
) {
  return {
    description: "Successful response",
    content: {
      "application/json": {
        schema: isRecord(outputSchema) || isReferenceObject(outputSchema)
          ? outputSchema
          : {
              type: "object",
              additionalProperties: true,
            },
      },
    },
  };
}

function isReferenceObject(
  value: unknown
): value is OpenAPIReferenceObject {
  return isRecord(value) && typeof value.$ref === "string";
}

function mergeSuccessResponse(
  response: OpenAPIResponsesObject["200"] | undefined,
  outputSchema: unknown | undefined
): OpenAPIResponsesObject["200"] {
  const defaultResponse = createDefaultSuccessResponse(outputSchema);

  if (response === undefined || isReferenceObject(response)) {
    return response ?? defaultResponse;
  }

  const existingJsonContent = response.content?.["application/json"];
  const defaultJsonContent = defaultResponse.content["application/json"];

  return {
    ...defaultResponse,
    ...response,
    content: {
      ...defaultResponse.content,
      ...response.content,
      "application/json": {
        ...defaultJsonContent,
        ...existingJsonContent,
        schema: existingJsonContent?.schema ?? defaultJsonContent.schema,
      },
    },
  };
}

function createResponses(
  outputSchema: unknown | undefined,
  responses: OpenAPIResponsesObject | undefined
): OpenAPIResponsesObject {
  if (responses === undefined) {
    return {
      "200": mergeSuccessResponse(undefined, outputSchema),
    };
  }

  if (outputSchema === undefined) {
    return responses;
  }

  return {
    ...responses,
    "200": mergeSuccessResponse(responses["200"], outputSchema),
  };
}

function sortJSONValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJSONValue(item));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
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

  const title = typeof schema.title === "string" ? schema.title : undefined;
  if (
    title !== undefined &&
    reusableTitles.has(title) &&
    title !== currentComponentTitle
  ) {
    return {
      $ref: `#/components/schemas/${title}`,
    };
  }

  return Object.fromEntries(
    Object.entries(schema).map(([key, entry]) => [
      key,
      replaceNamedSchemasWithRefs(entry, reusableTitles, currentComponentTitle),
    ])
  );
}

function createOutputSchemaRegistry(
  procedures: Array<{
    fullPath: string;
    outputSchema?: StandardSchemaV1;
  }>,
  existingSchemas:
    | OpenAPIPluginOptions["components"]
    | undefined
): {
  componentsSchemas: NonNullable<OpenAPIPluginOptions["components"]>["schemas"];
  resolvedOutputSchemasByPath: Map<string, unknown>;
} {
  const existingSchemaNames = new Set(
    Object.keys(existingSchemas?.schemas ?? {})
  );
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

    const candidates: Array<{ title: string; schema: Record<string, unknown> }> = [];
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

function createDefaultTags(
  path: string,
  defaultTags: OpenAPIPluginOptions["defaultTags"]
): string[] | undefined {
  if (defaultTags === false) {
    return undefined;
  }

  const [firstSegment] = path.split("/");

  return firstSegment ? [firstSegment] : undefined;
}

function createOperation(
  path: string,
  inputSchema: StandardSchemaV1 | undefined,
  outputSchema: unknown | undefined,
  meta: OpenAPIProcedureMeta | undefined,
  defaultTags: OpenAPIPluginOptions["defaultTags"]
): OpenAPIPathItemObject["post"] {
  const extractedInputSchema = extractInputJSONSchema(inputSchema);

  return {
    operationId: meta?.operationId ?? path.replace(/\//g, "."),
    summary: meta?.summary,
    description: meta?.description,
    tags: meta?.tags ?? createDefaultTags(path, defaultTags),
    deprecated: meta?.deprecated,
    security: meta?.security,
    requestBody:
      meta?.requestBody ??
      (inputSchema
        ? {
            ...createDefaultRequestBody(),
            content: {
              "application/json": {
                schema: isRecord(extractedInputSchema)
                  ? extractedInputSchema
                  : {
                      type: "object",
                      additionalProperties: true,
                    },
              },
            },
          }
        : undefined),
    responses: createResponses(outputSchema, meta?.responses),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function resolveSwaggerOptions(
  swagger: OpenAPIPluginOptions["swagger"],
  infoTitle: string
): ResolvedSwaggerOptions | null {
  if (!swagger) {
    return null;
  }

  if (swagger === true) {
    return {
      path: DEFAULT_SWAGGER_PATH,
      title: `${infoTitle} Swagger UI`,
      assetBaseUrl: DEFAULT_SWAGGER_ASSET_BASE,
      layout: "BaseLayout",
      persistAuthorization: true,
      displayOperationId: true,
      defaultModelsExpandDepth: 1,
      defaultModelExpandDepth: 1,
      docExpansion: "list",
      filter: false,
      tryItOutEnabled: true,
    };
  }

  return {
    path: swagger.path ?? DEFAULT_SWAGGER_PATH,
    title: swagger.title ?? `${infoTitle} Swagger UI`,
    assetBaseUrl: swagger.assetBaseUrl ?? DEFAULT_SWAGGER_ASSET_BASE,
    layout: swagger.layout ?? "BaseLayout",
    persistAuthorization: swagger.persistAuthorization ?? true,
    displayOperationId: swagger.displayOperationId ?? true,
    defaultModelsExpandDepth: swagger.defaultModelsExpandDepth ?? 1,
    defaultModelExpandDepth: swagger.defaultModelExpandDepth ?? 1,
    docExpansion: swagger.docExpansion ?? "list",
    filter: swagger.filter ?? false,
    tryItOutEnabled: swagger.tryItOutEnabled ?? true,
  };
}

function createSwaggerHtml(
  documentPath: string,
  swagger: ResolvedSwaggerOptions
): string {
  const escapedTitle = escapeHtml(swagger.title);
  const escapedAssetBaseUrl = escapeHtml(swagger.assetBaseUrl);
  const swaggerConfig = {
    url: documentPath,
    dom_id: "#swagger-ui",
    deepLinking: true,
    persistAuthorization: swagger.persistAuthorization,
    displayOperationId: swagger.displayOperationId,
    defaultModelsExpandDepth: swagger.defaultModelsExpandDepth,
    defaultModelExpandDepth: swagger.defaultModelExpandDepth,
    docExpansion: swagger.docExpansion,
    filter: swagger.filter,
    tryItOutEnabled: swagger.tryItOutEnabled,
    layout: swagger.layout,
  };
  const usesStandaloneLayout = swagger.layout === "StandaloneLayout";
  const standalonePresetScript = usesStandaloneLayout
    ? `\n    <script src="${escapedAssetBaseUrl}/swagger-ui-standalone-preset.js"></script>`
    : "";
  const standalonePresets = usesStandaloneLayout
    ? `,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset,
        ]`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="SwaggerUI" />
    <title>${escapedTitle}</title>
    <link rel="stylesheet" href="${escapedAssetBaseUrl}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${escapedAssetBaseUrl}/swagger-ui-bundle.js"></script>
    ${standalonePresetScript}
    <script>
      window.onload = () => {
        window.ui = SwaggerUIBundle({
          ...${JSON.stringify(swaggerConfig)}${standalonePresets}
        });
      };
    </script>
  </body>
</html>`;
}

export function createOpenAPIPlugin(): BunRPCPlugin<
  "openapi",
  OpenAPIProcedureMethods,
  OpenAPIPluginOptions,
  { document: OpenAPIObject }
> {
  return definePlugin({
    name: "openapi",
    procedure: {
      operationId: (operationId) => ({ operationId }),
      summary: (summary) => ({ summary }),
      description: (description) => ({ description }),
      tags: (...tags) => ({ tags }),
      deprecated: (deprecated = true) => ({ deprecated }),
      security: (...security) => ({ security }),
      requestBody: (requestBody) => ({ requestBody }),
      responses: (responses) => ({ responses }),
    },
    setup: ({ options, procedures }) => {
      const documentPath = options.documentPath ?? DEFAULT_DOCUMENT_PATH;
      const outputSchemaRegistry = createOutputSchemaRegistry(
        procedures,
        options.components
      );
      const paths = procedures.reduce<OpenAPIObject["paths"]>(
        (acc, procedure) => {
          acc[procedure.fullPath] = {
            post: createOperation(
              procedure.path,
              procedure.inputSchema,
              outputSchemaRegistry.resolvedOutputSchemasByPath.get(
                procedure.fullPath
              ),
              procedure.meta,
              options.defaultTags ?? "firstSegment"
            ),
          };

          return acc;
        },
        {}
      );

      const documentComponents =
        Object.keys(outputSchemaRegistry.componentsSchemas ?? {}).length === 0
          ? options.components
          : {
              ...options.components,
              schemas: {
                ...options.components?.schemas,
                ...outputSchemaRegistry.componentsSchemas,
              },
            };

      const document: OpenAPIObject = {
        openapi: "3.1.0",
        info: options.info,
        servers: options.servers,
        tags: options.tags,
        security: options.security,
        components: documentComponents,
        paths,
      };

      const routes: Record<
        string,
        () => Response
      > = {
        [documentPath]: () => Response.json(document),
      };

      const swagger = resolveSwaggerOptions(options.swagger, options.info.title);
      if (swagger) {
        routes[swagger.path] = () =>
          new Response(
            createSwaggerHtml(documentPath, swagger),
            {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
              },
            }
          );
      }

      return {
        extension: {
          document,
        },
        routes,
      };
    },
  });
}
