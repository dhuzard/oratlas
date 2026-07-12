import { NextResponse } from "next/server";
import { getReviewDetail } from "@/lib/reviews";
import { errorResponse, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Retrieve one immutable review version; version ids are scoped to the slug. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
) {
  try {
    const { slug, versionId } = await params;
    const review = await getReviewDetail(slug, versionId);
    if (!review) return errorResponse("not-found", "Review version not found.");
    return NextResponse.json(review);
  } catch (err) {
    return handleRouteError(err);
  }
}
