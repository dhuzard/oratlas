import { z } from "zod";

/**
 * Typed structured error envelope returned by all API routes.
 * Internal stack traces are never serialized into this shape.
 */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.string()).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export function apiError(code: string, message: string, details?: string[]): ApiError {
  return { error: { code, message, ...(details && details.length > 0 ? { details } : {}) } };
}

export const API_ERROR_CODES = [
  "bad-request",
  "unauthorized",
  "forbidden",
  "not-found",
  "conflict",
  "rate-limited",
  "payload-too-large",
  "upstream-error",
  "internal-error",
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
