import { NextResponse } from "next/server";
import { requireEditor } from "@/lib/auth";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPublicationRegistrationCaptureResource } from "@/lib/publication-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The audit view of one registration observation: what was asked for, where it
 * resolved to, the digests ORAtlas recomputed, the HTTP route it travelled and
 * why source-byte verification was or was not reached.
 *
 * Editor-only, and without the retained bytes: the digests and provenance are
 * what an audit needs, and re-serving untrusted external content through
 * ORAtlas's own API is an avoidable surface.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireEditor();
    const { id } = await params;
    const capture = await getPublicationRegistrationCaptureResource(id);
    if (!capture) return errorResponse("not-found", "Publication capture not found.");
    return NextResponse.json(capture, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
