import { NextResponse } from "next/server";
import { reviewLifecycleMutationSchema } from "@oratlas/contracts";
import { getServerEnv, requireEditor } from "@/lib/auth";
import {
  BadJsonError,
  BodyTooLargeError,
  errorResponse,
  handleRouteError,
  readJsonBody,
} from "@/lib/api";
import { validateSameOriginJsonRequest } from "@/lib/mutation-request";
import { LifecycleError, recordReviewLifecycleEvent } from "@/lib/review-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const integrity = validateSameOriginJsonRequest(request, getServerEnv().NEXT_PUBLIC_BASE_URL);
    if (!integrity.ok) {
      return errorResponse(
        integrity.status === 415 ? "bad-request" : "forbidden",
        integrity.message,
      );
    }
    const editor = await requireEditor();
    const parsed = reviewLifecycleMutationSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return errorResponse(
        "bad-request",
        "Invalid lifecycle event.",
        parsed.error.issues.map((issue) => issue.message),
      );
    }
    const result = await recordReviewLifecycleEvent(parsed.data, editor.id);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof LifecycleError) return errorResponse(error.code, error.message);
    if (error instanceof BodyTooLargeError) {
      return errorResponse("payload-too-large", "Request body too large.");
    }
    if (error instanceof BadJsonError) return errorResponse("bad-request", "Invalid JSON body.");
    return handleRouteError(error);
  }
}
