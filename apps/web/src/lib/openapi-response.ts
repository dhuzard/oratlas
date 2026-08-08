import "server-only";
import {
  OPENAPI_JSON,
  OPENAPI_JSON_ETAG,
  OPENAPI_YAML,
  OPENAPI_YAML_ETAG,
} from "@/generated/openapi-artifacts";
import { addDiscoveryHeaders } from "./public-discovery";

type OpenApiFormat = "json" | "yaml";

export function openApiResponse(request: Request, format: OpenApiFormat): Response {
  const etag = format === "yaml" ? OPENAPI_YAML_ETAG : OPENAPI_JSON_ETAG;
  const headers = new Headers({
    "Content-Type":
      format === "yaml" ? "application/yaml; charset=utf-8" : "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=300, s-maxage=3600",
    ETag: etag,
  });
  const notModified = request.headers.get("if-none-match") === etag;
  return addDiscoveryHeaders(
    new Response(notModified ? null : format === "yaml" ? OPENAPI_YAML : OPENAPI_JSON, {
      status: notModified ? 304 : 200,
      headers,
    }),
  );
}
