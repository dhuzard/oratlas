import { NextResponse } from "next/server";
import { platformTrustReviewStatusSchema } from "@oratlas/contracts";
import { z } from "zod";
import { getCurrentUser, getServerEnv, isEditor } from "@/lib/auth";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";
import {
  TrustEditorialError,
  verifyTrustAssessment,
  type TrustEditorIdentity,
} from "@/lib/trust-provenance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  assessmentId: z.string().min(1).max(200),
  subjectType: z.enum(["claim-citation", "node-relation"]).default("claim-citation"),
  status: platformTrustReviewStatusSchema,
  rationale: z.string().trim().min(10).max(4_000),
  expectedRevision: z.number().int().min(0),
  expectedAssessmentHash: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Platform verification/adjudication. Repository assertions cannot call this. */
export async function POST(request: Request) {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return NextResponse.json(
        {
          error: {
            code: integrity.status === 415 ? "bad-request" : "forbidden",
            message: integrity.message,
          },
        },
        { status: integrity.status },
      );
    }

    const user = await getCurrentUser();
    if (!user) return errorResponse("unauthorized", "Sign in required.");
    if (!isEditor(user)) return errorResponse("forbidden", "Editor role required.");

    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return errorResponse("bad-request", "Invalid TRUST verification payload.");
    const result = await verifyTrustAssessment(parsed.data, user as TrustEditorIdentity);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof TrustEditorialError) return errorResponse(error.code, error.message);
    if (error instanceof BodyTooLargeError)
      return errorResponse("payload-too-large", "Request body too large.");
    if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(error);
  }
}
