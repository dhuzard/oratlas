import "server-only";
import {
  describePublicationStructuralProvenance,
  publicationRegistrationCaptureResourceSchema,
  publicationResourceSchema,
  publicationVersionResourceSchema,
  type PublicationAdapterBinding,
  type PublicationClaimSourceBinding,
  type PublicationClaimTarget,
  type PublicationRegistrationCaptureResource,
  type PublicationRegistrationWarning,
  type PublicationResource,
  type PublicationSourceVerification,
  type PublicationStructuralProvenance,
  type PublicationVersionResource,
} from "@oratlas/contracts";
import { parseJsonColumn, prisma } from "./db";
import { appBaseUrl } from "./base-url";

/**
 * Read models for registered publications.
 *
 * These endpoints exist so a registration result can link to something real.
 * They describe what ORAtlas observed and nothing else: no assessment, no
 * TRUST value, no editorial status, and no canonical graph identity. The
 * canonical binding column is surfaced as an explicit `null`, because "not yet
 * decided" is a fact worth showing rather than a field worth omitting.
 */

function link(path: string): string {
  return `${appBaseUrl()}${path}`;
}

function provenanceOf(value: string): PublicationStructuralProvenance {
  return value === "source-byte" ? "source-byte" : "published-structure";
}

export async function getPublicationResource(id: string): Promise<PublicationResource | null> {
  const publication = await prisma.publication.findUnique({
    where: { id },
    include: {
      versions: {
        orderBy: { observedAt: "desc" },
        take: 500,
        include: { _count: { select: { claimOccurrences: true } } },
      },
    },
  });
  if (publication === null) return null;

  const evidence = parseJsonColumn<{ basis?: string }>(publication.identityEvidenceJson, {});
  return publicationResourceSchema.parse({
    schemaVersion: "1.0.0",
    id: publication.id,
    stableKey: publication.stableKey,
    publicationType: publication.publicationType,
    recordSource: publication.recordSource,
    ...(publication.sourceLocalPublicationId === null
      ? {}
      : { sourceLocalPublicationId: publication.sourceLocalPublicationId }),
    identityEvidenceBasis: evidence.basis,
    versions: publication.versions.map((version) => {
      const structuralProvenance = provenanceOf(version.structuralProvenance);
      return {
        id: version.id,
        stableKey: version.stableKey,
        sourcesSha256: version.sourcesSha256,
        ...(version.versionLabel === null ? {} : { versionLabel: version.versionLabel }),
        ...(version.title === null ? {} : { title: version.title }),
        ...(version.canonicalUrl === null ? {} : { canonicalUrl: version.canonicalUrl }),
        adapterType: version.adapterType,
        structuralProvenance,
        structuralProvenanceDescription:
          describePublicationStructuralProvenance(structuralProvenance),
        observedAt: version.observedAt.toISOString(),
        claimOccurrenceCount: version._count.claimOccurrences,
        links: {
          self: link(`/api/publications/${publication.id}/versions/${version.id}`),
        },
      };
    }),
    links: { self: link(`/api/publications/${publication.id}`) },
  });
}

export async function getPublicationVersionResource(
  publicationId: string,
  versionId: string,
): Promise<PublicationVersionResource | null> {
  const version = await prisma.publicationVersion.findFirst({
    where: { id: versionId, publicationId },
    include: {
      publication: true,
      claimOccurrences: { orderBy: { sourceLocalClaimId: "asc" }, take: 5_000 },
      captures: { orderBy: { capturedAt: "asc" }, take: 64 },
    },
  });
  if (version === null) return null;

  const adapter = parseJsonColumn<PublicationAdapterBinding | Record<string, never>>(
    version.adapterBindingJson,
    {},
  );
  const structuralProvenance = provenanceOf(version.structuralProvenance);

  return publicationVersionResourceSchema.parse({
    schemaVersion: "1.0.0",
    id: version.id,
    stableKey: version.stableKey,
    publicationId: version.publicationId,
    publicationStableKey: version.publication.stableKey,
    sourcesSha256: version.sourcesSha256,
    ...(version.versionLabel === null ? {} : { versionLabel: version.versionLabel }),
    ...(version.title === null ? {} : { title: version.title }),
    ...(version.canonicalUrl === null ? {} : { canonicalUrl: version.canonicalUrl }),
    adapterType: version.adapterType,
    protocolVersion: "protocolVersion" in adapter ? adapter.protocolVersion : undefined,
    structuralProvenance,
    structuralProvenanceDescription: describePublicationStructuralProvenance(structuralProvenance),
    observedAt: version.observedAt.toISOString(),
    claimOccurrences: version.claimOccurrences.map((occurrence) => {
      const target = parseJsonColumn<PublicationClaimTarget | { identifier?: string }>(
        occurrence.targetJson,
        {},
      );
      const binding = parseJsonColumn<PublicationClaimSourceBinding | Record<string, never>>(
        occurrence.sourceBindingJson,
        {},
      );
      return {
        id: occurrence.id,
        stableKey: occurrence.stableKey,
        sourceLocalClaimId: occurrence.sourceLocalClaimId,
        targetIdentifier: target.identifier,
        declarationAuthority: occurrence.declarationAuthority,
        declarationSha256: occurrence.declarationSha256,
        ...(occurrence.text === null ? {} : { text: occurrence.text }),
        ...(occurrence.claimType === null ? {} : { claimType: occurrence.claimType }),
        ...(occurrence.qualification === null ? {} : { qualification: occurrence.qualification }),
        sourceDocumentPath: "documentPath" in binding ? binding.documentPath : undefined,
        sourceDocumentSha256: "documentSha256" in binding ? binding.documentSha256 : undefined,
        // Never inferred. Null until an explicit, reviewed identity decision.
        canonicalKnowledgeNodeId: null,
      };
    }),
    captures: version.captures.map(captureView),
    links: {
      self: link(`/api/publications/${version.publicationId}/versions/${version.id}`),
      publication: link(`/api/publications/${version.publicationId}`),
    },
  });
}

interface CaptureRow {
  id: string;
  artifactKind: string;
  declaredPath: string | null;
  observedUrl: string | null;
  mediaType: string;
  contentSha256: string;
  byteLength: number;
  declaredSha256: string | null;
  capturedAt: Date;
}

function captureView(capture: CaptureRow) {
  return {
    id: capture.id,
    artifactKind: capture.artifactKind,
    ...(capture.declaredPath === null ? {} : { declaredPath: capture.declaredPath }),
    ...(capture.observedUrl === null ? {} : { observedUrl: capture.observedUrl }),
    mediaType: capture.mediaType,
    contentSha256: capture.contentSha256,
    byteLength: capture.byteLength,
    ...(capture.declaredSha256 === null ? {} : { declaredSha256: capture.declaredSha256 }),
    capturedAt: capture.capturedAt.toISOString(),
  };
}

/**
 * The audit view of one observation. Editor-only, and deliberately without the
 * retained bytes: digests, sizes and HTTP provenance are what an audit needs,
 * and re-serving untrusted external content through ORAtlas's API is a surface
 * worth not opening.
 */
export async function getPublicationRegistrationCaptureResource(
  id: string,
): Promise<PublicationRegistrationCaptureResource | null> {
  const capture = await prisma.publicationRegistrationCapture.findUnique({
    where: { id },
    include: {
      registration: true,
      publicationVersion: { select: { id: true, publicationId: true } },
      artifacts: { orderBy: { capturedAt: "asc" }, take: 64 },
    },
  });
  if (capture === null) return null;

  return publicationRegistrationCaptureResourceSchema.parse({
    schemaVersion: "1.0.0",
    id: capture.id,
    captureKey: capture.captureKey,
    registration: {
      id: capture.registration.id,
      manifestUrl: capture.registration.manifestUrl,
    },
    requestedManifestUrl: capture.requestedManifestUrl,
    resolvedManifestUrl: capture.resolvedManifestUrl,
    observedSiteRootUrl: capture.observedSiteRootUrl,
    manifestSha256: capture.manifestSha256,
    manifestProvenance: parseJsonColumn(capture.manifestProvenanceJson, {}),
    declaredSchemaVersion: capture.declaredSchemaVersion,
    adapterType: capture.adapterType,
    ...(capture.sourceLocalPublicationId === null
      ? {}
      : { sourceLocalPublicationId: capture.sourceLocalPublicationId }),
    sourcesSha256: capture.sourcesSha256,
    structuralProvenance: provenanceOf(capture.structuralProvenance),
    sourceVerification: parseJsonColumn<PublicationSourceVerification | Record<string, never>>(
      capture.sourceVerificationJson,
      {},
    ),
    warnings: parseJsonColumn<PublicationRegistrationWarning[]>(capture.warningsJson, []),
    capturedAt: capture.capturedAt.toISOString(),
    artifacts: capture.artifacts.map(captureView),
    links:
      capture.publicationVersion === null
        ? {}
        : {
            publication: link(`/api/publications/${capture.publicationVersion.publicationId}`),
            publicationVersion: link(
              `/api/publications/${capture.publicationVersion.publicationId}/versions/${capture.publicationVersion.id}`,
            ),
          },
  });
}
