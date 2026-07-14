import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { listProposalsForSlug } from "@/lib/claim-monitoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public living-review surface: update proposals for one review. Upstream
 * repositories can gate CI on `openCount === 0` so a retracted or corrected
 * source blocks releases until an editor resolves the proposal.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const result = await listProposalsForSlug(slug);
    if (!result) return errorResponse("not-found", "Review not found.");
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
