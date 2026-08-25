import { ZodError } from "zod";
import { BadJsonError, BodyTooLargeError, errorResponse, handleRouteError } from "./api";
import { VerificationError } from "./scientific-verification";
import { getServerEnv } from "./auth";
import { validateSameOriginJsonRequest } from "./mutation-request";

export function handleVerificationRouteError(error: unknown) {
  if (
    error instanceof BodyTooLargeError ||
    (error instanceof VerificationError && error.code === "payload-too-large")
  )
    return errorResponse("payload-too-large", error.message);
  if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
  if (error instanceof VerificationError) return errorResponse(error.code, error.message);
  if (error instanceof ZodError)
    return errorResponse(
      "bad-request",
      "Verification request does not satisfy the public contract.",
      error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  return handleRouteError(error);
}

export function validateVerificationAdminMutation(request: Request) {
  const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
  return integrity.ok
    ? null
    : errorResponse(
        integrity.status === 415 ? "unsupported-media-type" : "forbidden",
        integrity.message,
      );
}

export function validateVerifierJsonMutation(request: Request) {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  return mediaType === "application/json"
    ? null
    : errorResponse("unsupported-media-type", "Content-Type application/json is required.");
}
