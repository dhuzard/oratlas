import { NextResponse } from "next/server";
import { prisma, parseJsonColumn } from "@/lib/db";
import { errorResponse } from "@/lib/api";
import { resolveObservedPublicationBaseUrl } from "@oratlas/db";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const version = await prisma.publicationVersion.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          captures: true,
          claimOccurrences: true,
          contributors: true,
          productionAssertions: true,
          certificationResults: true,
        },
      },
      captures: {
        select: {
          id: true,
          artifactKind: true,
          observedUrl: true,
          requestedUrl: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!version) return errorResponse("not-found", "Publication version not found.");
  const observedPublicationBaseUrl = resolveObservedPublicationBaseUrl(version);
  if (!observedPublicationBaseUrl) {
    return errorResponse("conflict", "Publication version has no valid observed addressing.");
  }
  return NextResponse.json({
    schemaVersion: "1.0.0",
    id: version.id,
    publicationId: version.publicationId,
    publicationHref: `/api/publications/${version.publicationId}`,
    sourcesSha256: version.sourcesSha256,
    sourceLocalPublicationId: version.sourceLocalPublicationId,
    versionLabel: version.versionLabel,
    title: version.title,
    publisherCanonicalUrl: version.canonicalUrl,
    observedPublicationBaseUrl,
    adapterType: version.adapterType,
    adapter: parseJsonColumn(version.adapterBindingJson, null),
    source: parseJsonColumn(version.sourceDescriptorJson, null),
    verificationLevel: version.structuralProvenance,
    warnings: parseJsonColumn(version.verificationWarningsJson, []),
    observedAt: version.observedAt.toISOString(),
    packetHref: `/api/publication-versions/${version.id}/packet`,
    contentHref: `/api/publication-versions/${version.id}/content`,
    contentCompleteness: parseJsonColumn(version.contentCompletenessJson, {
      returnedDocuments: 0,
      totalDocumentsKnown: null,
      truncated: false,
      coverage: "unsupported",
    }),
    contributorsHref: `/api/publication-versions/${version.id}/contributors`,
    contributorDeclarationStatus: version.contributorsDeclared ? "source-declared" : "not-declared",
    contributorCount: version._count.contributors,
    productionProvenanceHref: `/api/publication-versions/${version.id}/production-provenance`,
    productionAssertionCount: version._count.productionAssertions,
    certificationsHref: `/api/publication-versions/${version.id}/certifications`,
    certificationCount: version._count.certificationResults,
    claimOccurrenceCount: version._count.claimOccurrences,
    captures: version.captures.map((capture) => ({
      id: capture.id,
      artifactKind: capture.artifactKind,
      href: `/api/publication-captures/${capture.id}`,
    })),
  });
}
