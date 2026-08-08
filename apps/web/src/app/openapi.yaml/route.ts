import { openApiResponse } from "@/lib/openapi-response";

export const runtime = "nodejs";

export function GET(request: Request): Response {
  return openApiResponse(request, "yaml");
}
