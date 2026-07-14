import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getClaimPassport } from "@/lib/claim-monitoring";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Machine-readable claim passport for one immutable version's claim. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ versionId: string; localClaimId: string }> },
) {
  try {
    const { versionId, localClaimId } = await params;
    const passport = await getClaimPassport(versionId, localClaimId);
    if (!passport) return errorResponse("not-found", "Claim not found.");
    return NextResponse.json(passport, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
