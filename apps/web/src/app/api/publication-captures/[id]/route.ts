import { NextResponse } from "next/server";
import { prisma, parseJsonColumn } from "@/lib/db";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const capture = await prisma.publicationCapture.findUnique({ where: { id } });
  if (!capture) return errorResponse("not-found", "Publication capture not found.");
  // Exact bytes are retained for audit but are intentionally not reflected by this metadata route.
  return NextResponse.json({
    schemaVersion: "1.0.0",
    id: capture.id,
    publicationVersionId: capture.publicationVersionId,
    publicationVersionHref: `/api/publication-versions/${capture.publicationVersionId}`,
    artifactKind: capture.artifactKind,
    declaredPath: capture.declaredPath,
    requestedUrl: capture.requestedUrl,
    observedUrl: capture.observedUrl,
    mediaType: capture.mediaType,
    contentSha256: capture.contentSha256,
    declaredSha256: capture.declaredSha256,
    byteLength: capture.byteLength,
    verificationLevel: capture.structuralProvenance,
    capturedAt: capture.capturedAt.toISOString(),
    httpProvenance: parseJsonColumn(capture.httpProvenanceJson, {}),
  });
}
