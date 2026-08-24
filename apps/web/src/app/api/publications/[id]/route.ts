import { NextResponse } from "next/server";
import { prisma, parseJsonColumn } from "@/lib/db";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const publication = await prisma.publication.findUnique({
    where: { id },
    include: { versions: { orderBy: { observedAt: "desc" } } },
  });
  if (!publication) return errorResponse("not-found", "Publication not found.");
  return NextResponse.json({
    schemaVersion: "1.0.0",
    id: publication.id,
    publicationType: publication.publicationType,
    recordSource: publication.recordSource,
    sourceLocalPublicationId: publication.sourceLocalPublicationId,
    identityEvidence: parseJsonColumn(publication.identityEvidenceJson, null),
    relationsHref: `/api/publications/${publication.id}/relations`,
    versions: publication.versions.map((version) => ({
      id: version.id,
      sourcesSha256: version.sourcesSha256,
      title: version.title,
      verificationLevel: version.structuralProvenance,
      href: `/api/publication-versions/${version.id}`,
    })),
  });
}
