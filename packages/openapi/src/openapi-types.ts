export type OpenAPIHttpMethod =
  | "get"
  | "put"
  | "post"
  | "delete"
  | "options"
  | "head"
  | "patch"
  | "trace";

export interface OpenAPIReferenceObject {
  $ref: string;
}

export interface OpenAPISchemaObject {
  additionalProperties?: boolean | OpenAPISchemaObject | OpenAPIReferenceObject;
  allOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  anyOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  description?: string;
  enum?: unknown[];
  example?: unknown;
  format?: string;
  items?: OpenAPISchemaObject | OpenAPIReferenceObject;
  nullable?: boolean;
  oneOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  properties?: Record<string, OpenAPISchemaObject | OpenAPIReferenceObject>;
  required?: string[];
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "object"
    | "null";
}

export interface OpenAPIMediaTypeObject {
  example?: unknown;
  schema?: OpenAPISchemaObject | OpenAPIReferenceObject;
}

export interface OpenAPIRequestBodyObject {
  content: Record<string, OpenAPIMediaTypeObject>;
  description?: string;
  required?: boolean;
}

export interface OpenAPIResponseObject {
  content?: Record<string, OpenAPIMediaTypeObject>;
  description: string;
}

export type OpenAPIResponsesObject = Record<
  string,
  OpenAPIResponseObject | OpenAPIReferenceObject
>;

export interface OpenAPIOperationObject {
  deprecated?: boolean;
  description?: string;
  operationId?: string;
  requestBody?: OpenAPIRequestBodyObject | OpenAPIReferenceObject;
  responses: OpenAPIResponsesObject;
  security?: OpenAPISecurityRequirementObject[];
  summary?: string;
  tags?: string[];
}

export type OpenAPIPathItemObject = Partial<
  Record<OpenAPIHttpMethod, OpenAPIOperationObject>
>;

export interface OpenAPIInfoObject {
  description?: string;
  summary?: string;
  title: string;
  version: string;
}

export interface OpenAPIServerObject {
  description?: string;
  url: string;
}

export interface OpenAPITagObject {
  description?: string;
  name: string;
}

export type OpenAPISecurityRequirementObject = Record<string, string[]>;

export interface OpenAPISecuritySchemeObject {
  bearerFormat?: string;
  description?: string;
  flows?: unknown;
  in?: "query" | "header" | "cookie";
  name?: string;
  openIdConnectUrl?: string;
  scheme?: string;
  type: "apiKey" | "http" | "mutualTLS" | "oauth2" | "openIdConnect";
}

export interface OpenAPIComponentsObject {
  requestBodies?: Record<
    string,
    OpenAPIRequestBodyObject | OpenAPIReferenceObject
  >;
  responses?: Record<string, OpenAPIResponseObject | OpenAPIReferenceObject>;
  schemas?: Record<string, OpenAPISchemaObject | OpenAPIReferenceObject>;
  securitySchemes?: Record<
    string,
    OpenAPISecuritySchemeObject | OpenAPIReferenceObject
  >;
}

export interface OpenAPIObject {
  components?: OpenAPIComponentsObject;
  info: OpenAPIInfoObject;
  openapi: "3.1.0";
  paths: Record<string, OpenAPIPathItemObject>;
  security?: OpenAPISecurityRequirementObject[];
  servers?: OpenAPIServerObject[];
  tags?: OpenAPITagObject[];
}

export interface SwaggerUIOptions {
  assetBaseUrl?: string;
  defaultModelExpandDepth?: number;
  defaultModelsExpandDepth?: number;
  displayOperationId?: boolean;
  docExpansion?: "list" | "full" | "none";
  filter?: boolean | string;
  layout?: "BaseLayout" | "StandaloneLayout";
  path?: string;
  persistAuthorization?: boolean;
  title?: string;
  tryItOutEnabled?: boolean;
}

export interface OpenAPIProcedureMeta {
  deprecated?: boolean;
  description?: string;
  openapi?: boolean;
  operationId?: string;
  requestBody?: OpenAPIRequestBodyObject | OpenAPIReferenceObject;
  responses?: OpenAPIResponsesObject;
  security?: OpenAPISecurityRequirementObject[];
  summary?: string;
  tags?: string[];
}

export interface OpenAPIPluginOptions {
  components?: OpenAPIComponentsObject;
  defaultTags?: "firstSegment" | false;
  documentPath?: string;
  info: OpenAPIInfoObject;
  security?: OpenAPISecurityRequirementObject[];
  servers?: OpenAPIServerObject[];
  swagger?: boolean | SwaggerUIOptions;
  tags?: OpenAPITagObject[];
}
