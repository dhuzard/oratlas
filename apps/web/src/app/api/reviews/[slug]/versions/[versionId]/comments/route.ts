import { NextResponse } from "next/server";
import { listReviewComments } from "@/lib/comments";
import { errorResponse, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Historical version comments are deliberately read-only: this route has no POST handler. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
) {
  try {
    const { slug, versionId } = await params;
    const comments = await listReviewComments(slug, versionId);
    if (!comments) return errorResponse("not-found", "Review version not found.");
    return NextResponse.json(comments);
  } catch (err) {
    return handleRouteError(err);
  }
}
