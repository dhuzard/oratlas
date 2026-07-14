import { NextResponse } from "next/server";
import { apiError, type ApiErrorCode } from "@oratlas/contracts";
import { AuthError } from "./auth";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  "bad-request": 400,
  unauthorized: 401,
  forbidden: 403,
  "not-found": 404,
  conflict: 409,
  "rate-limited": 429,
  "payload-too-large": 413,
  "upstream-error": 502,
  "internal-error": 500,
};

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  details?: string[],
): NextResponse {
  return NextResponse.json(apiError(code, message, details), { status: STATUS_BY_CODE[code] });
}

/** Convert thrown errors into typed responses without leaking stack traces. */
export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof AuthError) {
    return errorResponse(err.status === 403 ? "forbidden" : "unauthorized", err.message);
  }
  // Do not serialize internal error details to clients.
  console.error("[api] unhandled route error:", err);
  return errorResponse("internal-error", "An unexpected error occurred.");
}

export const MAX_BODY_BYTES = 256 * 1024;

/**
 * Parse and size-limit a JSON request body. The cap is enforced on the actual
 * UTF-8 byte length (not JS string length, which undercounts multi-byte
 * characters), with a fast path on a declared Content-Length so oversized
 * uploads are rejected before the whole body is buffered.
 */
export async function readJsonBody<T = unknown>(request: Request): Promise<T> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new BodyTooLargeError();
  }
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new BodyTooLargeError();
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new BadJsonError();
  }
}

export class BodyTooLargeError extends Error {}
export class BadJsonError extends Error {}
