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
  type?:
    | "string"
    | "number"
    | "integer"
    | "boolean"
    | "array"
    | "object"
    | "null";
  format?: string;
  description?: string;
  enum?: unknown[];
  items?: OpenAPISchemaObject | OpenAPIReferenceObject;
  properties?: Record<string, OpenAPISchemaObject | OpenAPIReferenceObject>;
  required?: string[];
  additionalProperties?:
    | boolean
    | OpenAPISchemaObject
    | OpenAPIReferenceObject;
  nullable?: boolean;
  example?: unknown;
  oneOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  anyOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
  allOf?: Array<OpenAPISchemaObject | OpenAPIReferenceObject>;
}

export interface OpenAPIMediaTypeObject {
  schema?: OpenAPISchemaObject | OpenAPIReferenceObject;
  example?: unknown;
}

export interface OpenAPIRequestBodyObject {
  description?: string;
  required?: boolean;
  content: Record<string, OpenAPIMediaTypeObject>;
}

export interface OpenAPIResponseObject {
  description: string;
  content?: Record<string, OpenAPIMediaTypeObject>;
}

export type OpenAPIResponsesObject = Record<
  string,
  OpenAPIResponseObject | OpenAPIReferenceObject
>;

export interface OpenAPIOperationObject {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  security?: OpenAPISecurityRequirementObject[];
  requestBody?: OpenAPIRequestBodyObject | OpenAPIReferenceObject;
  responses: OpenAPIResponsesObject;
}

export type OpenAPIPathItemObject = Partial<
  Record<OpenAPIHttpMethod, OpenAPIOperationObject>
>;

export interface OpenAPIInfoObject {
  title: string;
  version: string;
  summary?: string;
  description?: string;
}

export interface OpenAPIServerObject {
  url: string;
  description?: string;
}

export interface OpenAPITagObject {
  name: string;
  description?: string;
}

export type OpenAPISecurityRequirementObject = Record<string, string[]>;

export interface OpenAPISecuritySchemeObject {
  type: "apiKey" | "http" | "mutualTLS" | "oauth2" | "openIdConnect";
  description?: string;
  name?: string;
  in?: "query" | "header" | "cookie";
  scheme?: string;
  bearerFormat?: string;
  flows?: unknown;
  openIdConnectUrl?: string;
}

export interface OpenAPIComponentsObject {
  schemas?: Record<string, OpenAPISchemaObject | OpenAPIReferenceObject>;
  requestBodies?: Record<
    string,
    OpenAPIRequestBodyObject | OpenAPIReferenceObject
  >;
  responses?: Record<string, OpenAPIResponseObject | OpenAPIReferenceObject>;
  securitySchemes?: Record<
    string,
    OpenAPISecuritySchemeObject | OpenAPIReferenceObject
  >;
}

export interface OpenAPIObject {
  openapi: "3.1.0";
  info: OpenAPIInfoObject;
  servers?: OpenAPIServerObject[];
  tags?: OpenAPITagObject[];
  security?: OpenAPISecurityRequirementObject[];
  components?: OpenAPIComponentsObject;
  paths: Record<string, OpenAPIPathItemObject>;
}

export interface SwaggerUIOptions {
  path?: string;
  title?: string;
  assetBaseUrl?: string;
  layout?: "BaseLayout" | "StandaloneLayout";
  persistAuthorization?: boolean;
  displayOperationId?: boolean;
  defaultModelsExpandDepth?: number;
  defaultModelExpandDepth?: number;
  docExpansion?: "list" | "full" | "none";
  filter?: boolean | string;
  tryItOutEnabled?: boolean;
}

export interface OpenAPIProcedureMeta {
  openapi?: boolean;
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  security?: OpenAPISecurityRequirementObject[];
  requestBody?: OpenAPIRequestBodyObject | OpenAPIReferenceObject;
  responses?: OpenAPIResponsesObject;
}

export interface OpenAPIPluginOptions {
  info: OpenAPIInfoObject;
  documentPath?: string;
  servers?: OpenAPIServerObject[];
  tags?: OpenAPITagObject[];
  security?: OpenAPISecurityRequirementObject[];
  components?: OpenAPIComponentsObject;
  defaultTags?: "firstSegment" | false;
  swagger?: boolean | SwaggerUIOptions;
}
