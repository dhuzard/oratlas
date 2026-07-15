import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPublicProtocolSummary } from "@/lib/protocol-drift";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Public protocol snapshot provenance and neutral drift proposals for a review version. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  try {
    const { versionId } = await params;
    const summary = await getPublicProtocolSummary(versionId);
    if (!summary) return errorResponse("not-found", "Review version not found.");
    return NextResponse.json(summary, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
