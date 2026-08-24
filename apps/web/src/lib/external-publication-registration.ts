import "server-only";
import { createHash, createHmac } from "node:crypto";
import {
  canonicalJson,
  externalPublicationRegistrationResultSchema,
  normalizedPublicationProductionAssertionSchema,
  publicationIdentityEvidenceSchema,
  type ExternalPublicationRegistrationResult,
  type PublicationType,
} from "@oratlas/contracts";
import {
  createHardenedRemoteFetcher,
  verifyExternalPublication,
  type VerifiedExternalPublication,
} from "@oratlas/publications";
import { deriveObservedPublicationBaseUrl } from "@oratlas/db";
import { prisma } from "./db";
import { createPublicationSourceResolver } from "./publication-source-resolver";
import { getServerEnv } from "@oratlas/config";

export class PublicationRegistrationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationRegistrationConflictError";
  }
}

async function registrationKeyFor(manifestUrl: string): Promise<string> {
  const previous = await prisma.publicationCapture.findFirst({
    where: { artifactKind: "publication-manifest", requestedUrl: manifestUrl },
    orderBy: { createdAt: "asc" },
    select: {
      publicationVersion: {
        select: { publication: { select: { identityEvidenceJson: true } } },
      },
    },
  });
  if (previous) {
    try {
      const evidence = publicationIdentityEvidenceSchema.parse(
        JSON.parse(previous.publicationVersion.publication.identityEvidenceJson),
      );
      if (evidence.basis === "registration") return evidence.registrationKey;
    } catch {
      throw new PublicationRegistrationConflictError(
        "A previous registration has invalid identity provenance.",
      );
    }
  }
  // Opaque and deterministic for concurrent first registrations of the exact
  // same endpoint. Existing captures remain authoritative if the secret is
  // rotated; the URL itself is never stored as publication stableKey evidence.
  return `external-registration:${createHmac("sha256", getServerEnv().sessionSecret)
    .update(new URL(manifestUrl).href, "utf8")
    .digest("hex")}`;
}

function sameOptional(left: string | null, right: string | undefined): boolean {
  return left === (right ?? null);
}

function observedPublicationBaseUrl(verified: VerifiedExternalPublication): string {
  const manifests = verified.artifacts.filter(
    (artifact) => artifact.artifactKind === "publication-manifest",
  );
  if (manifests.length !== 1) {
    throw new PublicationRegistrationConflictError(
      "The verified publication must contain exactly one manifest capture.",
    );
  }
  const baseUrl = deriveObservedPublicationBaseUrl({
    observedUrl: manifests[0]!.observedUrl,
    requestedUrl: manifests[0]!.requestedUrl,
  });
  if (!baseUrl) {
    throw new PublicationRegistrationConflictError(
      "The manifest capture has no valid observed publication base URL.",
    );
  }
  return baseUrl;
}

function artifactIdentitySha256(
  artifact: VerifiedExternalPublication["artifacts"][number],
): string {
  const locatorType = artifact.declaredPath === undefined ? "url" : "path";
  const locator = artifact.declaredPath ?? artifact.requestedUrl ?? artifact.observedUrl;
  if (locator === undefined) {
    throw new PublicationRegistrationConflictError(
      `The ${artifact.artifactKind} artifact has no stable declared path or URL.`,
    );
  }
  return createHash("sha256")
    .update(`${artifact.artifactKind}\n${locatorType}\n${locator}`, "utf8")
    .digest("hex");
}

async function persistVerifiedExternalPublicationOnce(
  verified: VerifiedExternalPublication,
  actorId: string,
): Promise<ExternalPublicationRegistrationResult> {
  const { publication, version, occurrences } = verified.normalized;
  const observedBaseUrl = observedPublicationBaseUrl(verified);
  return prisma.$transaction(async (tx) => {
    let publicationRow = await tx.publication.findUnique({
      where: { stableKey: publication.stableKey },
    });
    if (!publicationRow) {
      publicationRow = await tx.publication.create({
        data: {
          stableKey: publication.stableKey,
          publicationType: publication.publicationType,
          recordSource: publication.recordSource,
          identityEvidenceJson: canonicalJson(publication.identityEvidence),
          sourceLocalPublicationId: publication.sourceLocalPublicationId,
        },
      });
    } else if (
      publicationRow.publicationType !== publication.publicationType ||
      publicationRow.recordSource !== publication.recordSource ||
      publicationRow.identityEvidenceJson !== canonicalJson(publication.identityEvidence)
    ) {
      throw new PublicationRegistrationConflictError(
        "The stable publication identity conflicts with an existing record.",
      );
    }

    let replayed = true;
    let versionRow = await tx.publicationVersion.findUnique({
      where: { stableKey: version.stableKey },
    });
    if (!versionRow) {
      replayed = false;
      versionRow = await tx.publicationVersion.create({
        data: {
          publicationId: publicationRow.id,
          stableKey: version.stableKey,
          sourceLocalPublicationId: version.sourceLocalPublicationId,
          sourcesSha256: version.sourcesSha256,
          versionLabel: version.versionLabel,
          title: version.title,
          canonicalUrl: version.canonicalUrl,
          observedPublicationBaseUrl: observedBaseUrl,
          adapterType: version.adapter.type,
          adapterBindingJson: canonicalJson(version.adapter),
          sourceDescriptorJson: version.source === undefined ? null : canonicalJson(version.source),
          structuralProvenance: version.structuralProvenance,
          verificationWarningsJson: canonicalJson(version.verificationWarnings),
          observedAt: new Date(version.observedAt),
        },
      });
    } else if (
      versionRow.publicationId !== publicationRow.id ||
      versionRow.sourcesSha256 !== version.sourcesSha256 ||
      !sameOptional(versionRow.canonicalUrl, version.canonicalUrl) ||
      (versionRow.observedPublicationBaseUrl !== null &&
        versionRow.observedPublicationBaseUrl !== observedBaseUrl) ||
      versionRow.adapterBindingJson !== canonicalJson(version.adapter) ||
      !sameOptional(
        versionRow.sourceDescriptorJson,
        version.source === undefined ? undefined : canonicalJson(version.source),
      ) ||
      versionRow.structuralProvenance !== version.structuralProvenance
    ) {
      throw new PublicationRegistrationConflictError(
        "The exact publication version conflicts with its previous immutable observation.",
      );
    }

    for (const rawAssertion of verified.normalized.productionAssertions ?? []) {
      const assertion = normalizedPublicationProductionAssertionSchema.parse(rawAssertion);
      const existingAssertion = await tx.publicationProductionAssertion.findUnique({
        where: {
          publicationVersionId_sourceAssertionKey: {
            publicationVersionId: versionRow.id,
            sourceAssertionKey: assertion.sourceAssertionKey,
          },
        },
      });
      if (!existingAssertion) {
        replayed = false;
        await tx.publicationProductionAssertion.create({
          data: {
            publicationVersionId: versionRow.id,
            sourceAssertionKey: assertion.sourceAssertionKey,
            mode: assertion.mode,
            actorsJson: canonicalJson(assertion.actors),
            activitiesJson: canonicalJson(assertion.activities),
            statement: assertion.statement,
            strength: assertion.strength,
            publicEvidenceUrl: assertion.publicEvidenceUrl,
            assertedAt: new Date(version.observedAt),
          },
        });
      } else if (
        existingAssertion.mode !== assertion.mode ||
        existingAssertion.actorsJson !== canonicalJson(assertion.actors) ||
        existingAssertion.activitiesJson !== canonicalJson(assertion.activities) ||
        !sameOptional(existingAssertion.statement, assertion.statement) ||
        existingAssertion.strength !== assertion.strength ||
        !sameOptional(existingAssertion.publicEvidenceUrl, assertion.publicEvidenceUrl) ||
        existingAssertion.agentRunId !== null ||
        existingAssertion.executionPassportId !== null ||
        existingAssertion.supersedesAssertionId !== null
      ) {
        throw new PublicationRegistrationConflictError(
          `Production assertion '${assertion.sourceAssertionKey}' conflicts with its immutable observation.`,
        );
      }
    }

    let manifestCaptureId: string | undefined;
    for (const artifact of verified.artifacts) {
      const identitySha256 = artifactIdentitySha256(artifact);
      const contentBytes = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        artifact.bytes,
      );
      let captureRow = await tx.publicationCapture.findFirst({
        where: {
          publicationVersionId: versionRow.id,
          artifactIdentitySha256: identitySha256,
        },
      });
      if (!captureRow) {
        replayed = false;
        captureRow = await tx.publicationCapture.create({
          data: {
            publicationVersionId: versionRow.id,
            artifactKind: artifact.artifactKind,
            artifactIdentitySha256: identitySha256,
            declaredPath: artifact.declaredPath,
            observedUrl: artifact.observedUrl,
            requestedUrl: artifact.requestedUrl,
            mediaType: artifact.mediaType,
            contentSha256: artifact.contentSha256,
            byteLength: artifact.bytes.byteLength,
            contentBytes,
            declaredSha256: artifact.declaredSha256,
            structuralProvenance: version.structuralProvenance,
            httpProvenanceJson: canonicalJson(artifact.provenance ?? {}),
            capturedAt: new Date(version.observedAt),
          },
        });
      } else if (
        captureRow.artifactKind !== artifact.artifactKind ||
        !sameOptional(captureRow.declaredPath, artifact.declaredPath) ||
        !sameOptional(captureRow.observedUrl, artifact.observedUrl) ||
        !sameOptional(captureRow.requestedUrl, artifact.requestedUrl) ||
        captureRow.mediaType !== artifact.mediaType ||
        captureRow.contentSha256 !== artifact.contentSha256 ||
        captureRow.byteLength !== artifact.bytes.byteLength ||
        captureRow.contentBytes !== contentBytes ||
        !sameOptional(captureRow.declaredSha256, artifact.declaredSha256) ||
        captureRow.structuralProvenance !== version.structuralProvenance
      ) {
        throw new PublicationRegistrationConflictError(
          `The ${artifact.artifactKind} artifact conflicts with its immutable capture.`,
        );
      }
      if (artifact.artifactKind === "publication-manifest") manifestCaptureId = captureRow.id;
    }
    if (!manifestCaptureId) {
      throw new PublicationRegistrationConflictError("The manifest capture was not persisted.");
    }

    for (const occurrence of occurrences) {
      const existing = await tx.publicationClaimOccurrence.findUnique({
        where: { stableKey: occurrence.stableKey },
      });
      const declaration = occurrence.declaration;
      const authoritativeDeclaration =
        declaration.authority === "publication-source"
          ? declaration
          : verified.delegatedDeclarations?.get(occurrence.sourceLocalClaimId);
      if (!authoritativeDeclaration) {
        throw new PublicationRegistrationConflictError(
          `Claim occurrence ${occurrence.sourceLocalClaimId} has no authoritative declaration.`,
        );
      }
      if (existing) {
        const publishedUrl = verified.resolvedClaimUrls.get(occurrence.sourceLocalClaimId);
        if (
          existing.publicationVersionId !== versionRow.id ||
          existing.targetJson !== canonicalJson(occurrence.target) ||
          existing.publishedUrl !== publishedUrl ||
          existing.sourceBindingJson !== canonicalJson(occurrence.sourceBinding) ||
          existing.selectorJson !== canonicalJson(occurrence.selector) ||
          existing.declarationSha256 !== occurrence.declarationSha256 ||
          existing.declarationAuthority !== declaration.authority ||
          existing.text !== authoritativeDeclaration.text ||
          !sameOptional(existing.claimType, authoritativeDeclaration.claimType) ||
          !sameOptional(existing.qualification, authoritativeDeclaration.qualification)
        ) {
          throw new PublicationRegistrationConflictError(
            `Claim occurrence ${occurrence.sourceLocalClaimId} conflicts with its immutable capture.`,
          );
        }
        continue;
      }
      replayed = false;
      await tx.publicationClaimOccurrence.create({
        data: {
          publicationVersionId: versionRow.id,
          sourceLocalClaimId: occurrence.sourceLocalClaimId,
          stableKey: occurrence.stableKey,
          targetJson: canonicalJson(occurrence.target),
          publishedUrl: verified.resolvedClaimUrls.get(occurrence.sourceLocalClaimId),
          sourceBindingJson: canonicalJson(occurrence.sourceBinding),
          selectorJson: canonicalJson(occurrence.selector),
          declarationSha256: occurrence.declarationSha256,
          declarationAuthority: declaration.authority,
          text: authoritativeDeclaration.text,
          claimType: authoritativeDeclaration.claimType,
          qualification: authoritativeDeclaration.qualification,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "external-publication.register",
        subjectType: "publication-version",
        subjectId: versionRow.id,
        detailsJson: canonicalJson({
          manifestCaptureId,
          manifestSchemaVersion: verified.manifest.schemaVersion,
          adapterType: verified.manifest.adapter.type,
          claimOccurrenceCount: occurrences.length,
          verificationLevel: versionRow.structuralProvenance,
          warnings: verified.warnings,
          replayed,
        }),
      },
    });

    return externalPublicationRegistrationResultSchema.parse({
      schemaVersion: "1.0.0",
      captureId: manifestCaptureId,
      publicationId: publicationRow.id,
      publicationVersionId: versionRow.id,
      manifestSchemaVersion: verified.manifest.schemaVersion,
      adapterType: verified.manifest.adapter.type,
      claimOccurrenceCount: occurrences.length,
      verificationLevel: versionRow.structuralProvenance,
      warnings: verified.warnings,
      replayed,
      links: {
        capture: `/api/publication-captures/${manifestCaptureId}`,
        publication: `/api/publications/${publicationRow.id}`,
        publicationVersion: `/api/publication-versions/${versionRow.id}`,
      },
    });
  });
}

function isUniqueWriteRace(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Retry one rolled-back uniqueness race so concurrent identical registration is idempotent. */
export async function persistVerifiedExternalPublication(
  verified: VerifiedExternalPublication,
  actorId: string,
): Promise<ExternalPublicationRegistrationResult> {
  try {
    return await persistVerifiedExternalPublicationOnce(verified, actorId);
  } catch (error) {
    if (!isUniqueWriteRace(error)) throw error;
    return persistVerifiedExternalPublicationOnce(verified, actorId);
  }
}

export async function registerExternalPublication(input: {
  manifestUrl: string;
  publicationType: PublicationType;
  actorId: string;
}): Promise<ExternalPublicationRegistrationResult> {
  const registrationKey = await registrationKeyFor(input.manifestUrl);
  const verified = await verifyExternalPublication({
    manifestUrl: input.manifestUrl,
    publicationType: input.publicationType,
    registrationKey,
    fetcher: createHardenedRemoteFetcher(),
    sourceResolver: createPublicationSourceResolver(),
  });
  return persistVerifiedExternalPublication(verified, input.actorId);
}
