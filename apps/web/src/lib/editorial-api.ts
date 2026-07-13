import "server-only";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "./api";
import { getServerEnv, requireUser, type SessionUser } from "./auth";
import { LifecycleError } from "./editorial-lifecycle";
import { validateSameOriginJsonRequest } from "./mutation-request";
import { SubmissionError } from "./submissions";

/**
 * Shared plumbing for cookie-authenticated lifecycle mutations: same-origin
 * integrity, session, size-limited JSON body, zod validation and typed
 * domain-error mapping.
 */
export async function handleLifecyclePost<Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema,
  handler: (actor: SessionUser, body: z.infer<Schema>) => Promise<unknown>,
): Promise<NextResponse> {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "bad-request" : "forbidden",
        integrity.message,
      );
    }
    const actor = await requireUser();
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return errorResponse("bad-request", "Invalid request payload.");
    }
    const result = await handler(actor, parsed.data);
    return NextResponse.json(result ?? { ok: true });
  } catch (err) {
    if (err instanceof LifecycleError) return errorResponse(err.code, err.message);
    if (err instanceof SubmissionError) return errorResponse(err.code, err.message);
    if (err instanceof z.ZodError) return errorResponse("bad-request", "Invalid request payload.");
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
