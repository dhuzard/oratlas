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
import { MonitoringError } from "./claim-monitoring";
import { ProtocolDriftError } from "./protocol-drift";
import { LifecycleError } from "./editorial-lifecycle";
import { FederationError } from "./federation";
import { ExecutionPassportError } from "./execution-passports";
import { validateSameOriginJsonRequest } from "./mutation-request";
import { clientKey, rateLimit, rateLimitDefaults } from "./rate-limit";
import { SubmissionError } from "./submissions";
import { ReplicationMarketplaceError } from "./replication-marketplace";
import { NodeEdgeLifecycleError } from "./node-edge-lifecycle";
import { SynthesisEditorialError } from "./synthesis-editorial";
import { SynthesisStalenessError } from "./synthesis-staleness";
import { NodeIdentityLifecycleError } from "./node-identity-lifecycle";
import { ChallengeError } from "./challenges";

/**
 * Shared plumbing for cookie-authenticated lifecycle mutations: same-origin
 * integrity, session, size-limited JSON body, zod validation and typed
 * domain-error mapping.
 */
export async function handleLifecyclePost<Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema,
  handler: (actor: SessionUser, body: z.infer<Schema>) => Promise<unknown>,
  limitSuffix = "lifecycle",
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
    const { max, windowMs } = rateLimitDefaults();
    const limit = rateLimit(
      clientKey(request.headers, `${limitSuffix}:${actor.id}`),
      max,
      windowMs,
    );
    if (!limit.ok) {
      return errorResponse("rate-limited", "Too many editorial actions. Try again shortly.");
    }
    const parsed = schema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return errorResponse("bad-request", "Invalid request payload.");
    }
    const result = await handler(actor, parsed.data);
    if (result instanceof NextResponse) return result;
    return NextResponse.json(result ?? { ok: true });
  } catch (err) {
    if (err instanceof LifecycleError) return errorResponse(err.code, err.message);
    if (err instanceof FederationError) return errorResponse(err.code, err.message);
    if (err instanceof MonitoringError) return errorResponse(err.code, err.message);
    if (err instanceof ProtocolDriftError) return errorResponse(err.code, err.message);
    if (err instanceof SubmissionError) return errorResponse(err.code, err.message);
    if (err instanceof ReplicationMarketplaceError) return errorResponse(err.code, err.message);
    if (err instanceof NodeEdgeLifecycleError) return errorResponse(err.code, err.message);
    if (err instanceof NodeIdentityLifecycleError) return errorResponse(err.code, err.message);
    if (err instanceof ExecutionPassportError) return errorResponse(err.code, err.message);
    if (err instanceof SynthesisEditorialError) return errorResponse(err.code, err.message);
    if (err instanceof SynthesisStalenessError) return errorResponse(err.code, err.message);
    if (err instanceof ChallengeError) return errorResponse(err.code, err.message);
    if (err instanceof z.ZodError) return errorResponse("bad-request", "Invalid request payload.");
    if (err instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (err instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(err);
  }
}
