import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getProcessHistory } from "@/lib/editorial-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public, immutable editorial process history for a submission and its
 * revision lineage. Open review: reports, responses and decision letters are
 * public and attributable.
 */
export async function GET(request: Request) {
  try {
    const submissionId = new URL(request.url).searchParams.get("submissionId");
    if (!submissionId) return errorResponse("bad-request", "submissionId is required.");
    const history = await getProcessHistory(submissionId);
    if (history.length === 0) return errorResponse("not-found", "Submission not found.");
    return NextResponse.json({ history });
  } catch (err) {
    return handleRouteError(err);
  }
}
