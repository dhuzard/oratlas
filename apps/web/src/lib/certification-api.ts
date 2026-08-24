import { ZodError } from "zod";
import { BadJsonError, BodyTooLargeError, errorResponse, handleRouteError } from "./api";
import { CertificationError } from "./certification";
import { getServerEnv } from "./auth";
import { validateSameOriginJsonRequest } from "./mutation-request";

export function handleCertificationRouteError(error: unknown) {
  if (error instanceof BodyTooLargeError)
    return errorResponse("payload-too-large", "Request body too large.");
  if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
  if (error instanceof CertificationError) return errorResponse(error.code, error.message);
  if (error instanceof ZodError)
    return errorResponse(
      "bad-request",
      "Certification request does not satisfy the public contract.",
      error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  return handleRouteError(error);
}

export function validateCertificationAdminMutation(request: Request) {
  const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
  return integrity.ok
    ? null
    : errorResponse(
        integrity.status === 415 ? "unsupported-media-type" : "forbidden",
        integrity.message,
      );
}

/** Bearer-authenticated certifier writes are cross-origin capable but JSON-only. */
export function validateCertifierJsonMutation(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    ? null
    : errorResponse("unsupported-media-type", "Content-Type application/json is required.");
}
