import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPublicationVersionResource } from "@/lib/publication-queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * One exact observed publication version: its adapter binding, the artifacts
 * captured for it, and the source occurrences materialized from them.
 *
 * Every occurrence reports `canonicalKnowledgeNodeId: null`. A canonical
 * binding is an explicit, reviewed decision and is never inferred from an
 * occurrence's text, id, digest or position.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const { id, versionId } = await params;
    const version = await getPublicationVersionResource(id, versionId);
    if (!version) return errorResponse("not-found", "Publication version not found.");
    return NextResponse.json(version, {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
