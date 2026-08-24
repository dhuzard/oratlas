import { NextResponse } from "next/server";
import { prisma, parseJsonColumn } from "@/lib/db";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const version = await prisma.publicationVersion.findUnique({
    where: { id },
    include: {
      _count: { select: { captures: true, claimOccurrences: true } },
      captures: { select: { id: true, artifactKind: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!version) return errorResponse("not-found", "Publication version not found.");
  return NextResponse.json({
    schemaVersion: "1.0.0",
    id: version.id,
    publicationId: version.publicationId,
    publicationHref: `/api/publications/${version.publicationId}`,
    sourcesSha256: version.sourcesSha256,
    sourceLocalPublicationId: version.sourceLocalPublicationId,
    versionLabel: version.versionLabel,
    title: version.title,
    canonicalUrl: version.canonicalUrl,
    adapterType: version.adapterType,
    adapter: parseJsonColumn(version.adapterBindingJson, null),
    source: parseJsonColumn(version.sourceDescriptorJson, null),
    verificationLevel: version.structuralProvenance,
    warnings: parseJsonColumn(version.verificationWarningsJson, []),
    observedAt: version.observedAt.toISOString(),
    packetHref: `/api/publication-versions/${version.id}/packet`,
    claimOccurrenceCount: version._count.claimOccurrences,
    captures: version.captures.map((capture) => ({
      id: capture.id,
      artifactKind: capture.artifactKind,
      href: `/api/publication-captures/${capture.id}`,
    })),
  });
}
