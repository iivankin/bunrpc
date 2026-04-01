import type { BunRPCPlugin, StandardSchemaV1 } from "@bunrpc/core";
import {
  extractInputJSONSchema,
  isRecord,
  isReferenceObject,
} from "./json-schema";
import type {
  OpenAPIObject,
  OpenAPIPathItemObject,
  OpenAPIPluginOptions,
  OpenAPIProcedureMeta,
  OpenAPIReferenceObject,
  OpenAPIRequestBodyObject,
  OpenAPIResponsesObject,
  OpenAPISecurityRequirementObject,
} from "./openapi-types";
import { createOutputSchemaRegistry } from "./output-schema-registry";
import { createSwaggerHtml, resolveSwaggerOptions } from "./swagger-ui";

const DEFAULT_DOCUMENT_PATH = "/openapi.json";

export interface OpenAPIProcedureMethods {
  deprecated: (
    deprecated?: boolean
  ) => Pick<OpenAPIProcedureMeta, "deprecated">;
  description: (
    description: string
  ) => Pick<OpenAPIProcedureMeta, "description">;
  openapi: (enabled?: boolean) => Pick<OpenAPIProcedureMeta, "openapi">;
  operationId: (
    operationId: string
  ) => Pick<OpenAPIProcedureMeta, "operationId">;
  requestBody: (
    requestBody: OpenAPIRequestBodyObject | OpenAPIReferenceObject
  ) => Pick<OpenAPIProcedureMeta, "requestBody">;
  responses: (
    responses: OpenAPIResponsesObject
  ) => Pick<OpenAPIProcedureMeta, "responses">;
  security: (
    ...security: OpenAPISecurityRequirementObject[]
  ) => Pick<OpenAPIProcedureMeta, "security">;
  summary: (summary: string) => Pick<OpenAPIProcedureMeta, "summary">;
  tags: (...tags: string[]) => Pick<OpenAPIProcedureMeta, "tags">;
}

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

function createDefaultSuccessResponse(outputSchema: unknown | undefined) {
  return {
    description: "Successful response",
    content: {
      "application/json": {
        schema:
          isRecord(outputSchema) || isReferenceObject(outputSchema)
            ? outputSchema
            : {
                type: "object",
                additionalProperties: true,
              },
      },
    },
  };
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

export function openapi(
  options: OpenAPIPluginOptions
): BunRPCPlugin<
  "openapi",
  OpenAPIPluginOptions,
  OpenAPIProcedureMethods,
  OpenAPIProcedureMeta,
  { document: OpenAPIObject }
> {
  return {
    name: "openapi",
    options,
    methods: {
      openapi: (enabled = true) => ({ openapi: enabled }),
      operationId: (operationId) => ({ operationId }),
      summary: (summary) => ({ summary }),
      description: (description) => ({ description }),
      tags: (...tags) => ({ tags }),
      deprecated: (deprecated = true) => ({ deprecated }),
      security: (...security) => ({ security }),
      requestBody: (requestBody) => ({ requestBody }),
      responses: (responses) => ({ responses }),
    },
    setup: ({ options: pluginOptions, procedures }) => {
      const documentProcedures = procedures.filter(
        (procedure) =>
          procedure.httpExposed && procedure.meta?.openapi !== false
      );
      const documentPath = pluginOptions.documentPath ?? DEFAULT_DOCUMENT_PATH;
      const outputSchemaRegistry = createOutputSchemaRegistry(
        documentProcedures,
        pluginOptions.components
      );
      const paths = documentProcedures.reduce<OpenAPIObject["paths"]>(
        (documentPaths, procedure) => {
          documentPaths[procedure.fullPath] = {
            post: createOperation(
              procedure.path,
              procedure.inputSchema,
              outputSchemaRegistry.resolvedOutputSchemasByPath.get(
                procedure.fullPath
              ),
              procedure.meta,
              pluginOptions.defaultTags ?? "firstSegment"
            ),
          };

          return documentPaths;
        },
        {}
      );

      const documentComponents =
        Object.keys(outputSchemaRegistry.componentsSchemas ?? {}).length === 0
          ? pluginOptions.components
          : {
              ...pluginOptions.components,
              schemas: {
                ...pluginOptions.components?.schemas,
                ...outputSchemaRegistry.componentsSchemas,
              },
            };

      const document: OpenAPIObject = {
        openapi: "3.1.0",
        info: pluginOptions.info,
        servers: pluginOptions.servers,
        tags: pluginOptions.tags,
        security: pluginOptions.security,
        components: documentComponents,
        paths,
      };

      const routes: Record<string, () => Response> = {
        [documentPath]: () => Response.json(document),
      };

      const swagger = resolveSwaggerOptions(
        pluginOptions.swagger,
        pluginOptions.info.title
      );
      if (swagger) {
        routes[swagger.path] = () =>
          new Response(createSwaggerHtml(documentPath, swagger), {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
            },
          });
      }

      return {
        extension: {
          document,
        },
        routes,
      };
    },
  };
}
