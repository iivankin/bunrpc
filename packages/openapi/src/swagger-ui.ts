import type { SwaggerUIOptions } from "./openapi-types";

const DEFAULT_SWAGGER_PATH = "/docs";
const DEFAULT_SWAGGER_ASSET_BASE = "https://unpkg.com/swagger-ui-dist@5.11.0";

export interface ResolvedSwaggerOptions extends Required<SwaggerUIOptions> {}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function resolveSwaggerOptions(
  swagger: boolean | SwaggerUIOptions | undefined,
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

export function createSwaggerHtml(
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
