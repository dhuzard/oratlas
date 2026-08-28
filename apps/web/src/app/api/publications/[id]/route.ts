import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPublicationResource } from "@/lib/publication-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One registered publication and the exact versions ORAtlas observed of it.
 *
 * Structural provenance only: nothing here is an assessment, a TRUST value, or
 * a canonical graph identity.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const publication = await getPublicationResource(id);
    if (!publication) return errorResponse("not-found", "Publication not found.");
    return NextResponse.json(publication, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
