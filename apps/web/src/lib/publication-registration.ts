import "server-only";
import {
  publicationRegistrationResultSchema,
  type ApiErrorCode,
  type PublicationHttpProvenance,
  type PublicationRegistrationErrorCode,
  type PublicationRegistrationResult,
  type PublicationType,
} from "@oratlas/contracts";
import {
  PublicationRegistrationError,
  registerPublicationFromManifest,
  type CapturedArtifact,
  type PublicationObservation,
  type PublicationSourceDocumentResolver,
} from "@oratlas/publications";
import {
  assessExternalUrl,
  createSafeArtifactFetcher,
  OperationBudget,
  type UrlSafetyPolicy,
} from "@oratlas/safe-fetch";
import { getServerEnv } from "@oratlas/config";
import { prisma } from "./db";
import { withSqliteRetry } from "./db-retry";
import { appBaseUrl } from "./base-url";
import { createGithubSourceDocumentResolver } from "./publication-source-resolver";

/**
 * Registering an externally hosted publication.
 *
 * This is the operational half of "ORAtlas does not host the publication": an
 * operator supplies a manifest URL, ORAtlas retrieves it through the hardened
 * outbound boundary, retains exactly the bytes it saw, validates them
 * fail-closed, and materializes generic publication records.
 *
 * **Registering a URL is not a claim to own it.** Nothing here proves that the
 * operator is entitled to register `https://lab.org/review/`, and no field
 * pretends otherwise. Registration is therefore an editorial operation,
 * attributed to the editor who performed it, and ownership proof is named as
 * an unsolved governance problem in `docs/external-publications.md` rather
 * than approximated with a boolean.
 *
 * The pipeline stops at source occurrences. Binding one to a canonical claim
 * is a separate, explicit, reviewed decision.
 */

export class PublicationRegistrationServiceError extends Error {
  readonly code: ApiErrorCode;
  /** Stable machine reason, safe to return: never a network or internal detail. */
  readonly reason: PublicationRegistrationErrorCode;
  readonly detail: string | undefined;

  constructor(
    code: ApiErrorCode,
    reason: PublicationRegistrationErrorCode,
    message: string,
    detail?: string,
  ) {
    super(message);
    this.name = "PublicationRegistrationServiceError";
    this.code = code;
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * HTTP status class for a refusal.
 *
 * A URL ORAtlas will not accept is the caller's mistake; a publication that
 * failed validation is the publication's; a publication that could not be
 * retrieved is upstream. None of the three returns an internal error.
 */
const API_ERROR_CODE_BY_REASON: Record<PublicationRegistrationErrorCode, ApiErrorCode> = {
  "manifest-url-rejected": "bad-request",
  "manifest-unreachable": "upstream-error",
  "manifest-invalid-json": "upstream-error",
  "manifest-schema-unsupported": "upstream-error",
  "manifest-invalid": "upstream-error",
  "adapter-not-supported": "upstream-error",
  "artifact-path-unsafe": "upstream-error",
  "artifact-unreachable": "upstream-error",
  "artifact-digest-mismatch": "upstream-error",
  "artifact-record-count-mismatch": "upstream-error",
  "artifact-malformed": "upstream-error",
  "claim-record-invalid": "upstream-error",
  "duplicate-source-local-claim-id": "upstream-error",
  "cross-reference-target-missing": "upstream-error",
  "cross-reference-inventory-invalid": "upstream-error",
  "page-data-claim-node-missing": "upstream-error",
  "declaration-authority-conflict": "upstream-error",
  "source-verification-mismatch": "upstream-error",
  "limit-exceeded": "upstream-error",
  "publication-identity-insufficient": "upstream-error",
};

/** Total wall-clock budget for one registration, across every retrieval. */
const REGISTRATION_TOTAL_TIMEOUT_MS = 30_000;

/**
 * The outbound policy registration runs under.
 *
 * Production is https-only, public destinations only, standard ports only.
 * Development may opt into a loopback fixture with an explicit environment
 * flag, which `@oratlas/config` refuses to honour in production.
 */
export function registrationUrlPolicy(): UrlSafetyPolicy {
  if (!getServerEnv().publicationRegistrationInsecureFetchEnabled) return {};
  return { allowInsecureHttp: true, allowLoopback: true, allowNonStandardPorts: true };
}

export interface RegisterExternalPublicationInput {
  manifestUrl: string;
  /** Supplied by the operator; the producer contract declares no type. */
  publicationType?: PublicationType;
  /** Editor performing the registration. Attribution, not ownership. */
  actorId: string;
}

export interface RegisterExternalPublicationOptions {
  /** Injected in tests; production uses the configured GitHub-backed resolver. */
  sourceResolver?: PublicationSourceDocumentResolver | null;
  now?: () => Date;
}

function linkFor(path: string): string {
  return `${appBaseUrl()}${path}`;
}

/**
 * Run the pipeline, then persist the observation.
 *
 * Nothing is written until the whole observation validates: a refused
 * registration leaves no partial publication behind, and a caller cannot fill
 * the archive with fragments by pointing it at broken sites.
 */
export async function registerExternalPublication(
  input: RegisterExternalPublicationInput,
  options: RegisterExternalPublicationOptions = {},
): Promise<PublicationRegistrationResult> {
  const policy = registrationUrlPolicy();
  const admitted = assessExternalUrl(input.manifestUrl, policy);
  if (!admitted.ok) {
    throw new PublicationRegistrationServiceError(
      "bad-request",
      "manifest-url-rejected",
      "That URL is not an acceptable registration target.",
      admitted.reason,
    );
  }

  const sourceResolver =
    options.sourceResolver === undefined
      ? createGithubSourceDocumentResolver()
      : (options.sourceResolver ?? undefined);

  let observation: PublicationObservation;
  try {
    observation = await registerPublicationFromManifest({
      manifestUrl: admitted.url.href,
      publicationType: input.publicationType ?? "other",
      fetcher: createSafeArtifactFetcher({
        policy,
        budget: new OperationBudget(REGISTRATION_TOTAL_TIMEOUT_MS),
        userAgent: "open-review-atlas",
      }),
      ...(sourceResolver === undefined ? {} : { sourceResolver }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  } catch (error) {
    if (error instanceof PublicationRegistrationError) {
      throw new PublicationRegistrationServiceError(
        API_ERROR_CODE_BY_REASON[error.code],
        error.code,
        error.message,
        error.detail,
      );
    }
    throw error;
  }

  return persistObservation({
    manifestUrl: admitted.url.href,
    publicationType: input.publicationType ?? "other",
    actorId: input.actorId,
    observation,
  });
}

interface PersistInput {
  manifestUrl: string;
  publicationType: PublicationType;
  actorId: string;
  observation: PublicationObservation;
}

function artifactRow(artifact: CapturedArtifact, capturedAt: Date, provenance: string) {
  return {
    artifactKind: artifact.kind,
    declaredPath: artifact.declaredPath ?? null,
    observedUrl: artifact.provenance.finalUrl,
    mediaType: artifact.mediaType,
    contentSha256: artifact.sha256,
    byteLength: artifact.byteLength,
    contentBytes: artifact.text,
    declaredSha256: artifact.declaredSha256 ?? null,
    httpProvenanceJson: provenance,
    capturedAt,
  };
}

async function persistObservation(input: PersistInput): Promise<PublicationRegistrationResult> {
  const { observation } = input;
  const { capture, normalized } = observation;
  const capturedAt = new Date(capture.capturedAt);

  return withSqliteRetry(
    () =>
      prisma.$transaction(async (tx) => {
        const registration = await tx.publicationRegistration.upsert({
          where: { manifestUrl: input.manifestUrl },
          // The URL is immutable; the publication type stays editorially
          // correctable, so a later registration of the same URL may restate it.
          update: { publicationType: input.publicationType },
          create: {
            manifestUrl: input.manifestUrl,
            publicationType: input.publicationType,
            registeredById: input.actorId,
          },
        });

        // Deterministic idempotency: an identical observation replays its capture
        // rather than creating a second one. A capture is never overwritten.
        const existing = await tx.publicationRegistrationCapture.findUnique({
          where: { captureKey: capture.captureKey },
          include: { publicationVersion: { include: { publication: true } } },
        });
        if (existing !== null && existing.publicationVersion === null) {
          // Unreachable while the binding is made inside this transaction; kept
          // so a half-written capture is refused rather than silently duplicated.
          throw new PublicationRegistrationServiceError(
            "conflict",
            "limit-exceeded",
            "That observation is already being captured.",
          );
        }
        if (existing?.publicationVersion) {
          return buildResult({
            disposition: "replayed",
            registration,
            captureRow: existing,
            publicationId: existing.publicationVersion.publicationId,
            publicationVersionId: existing.publicationVersion.id,
            publicationStableKey: existing.publicationVersion.publication.stableKey,
            publicationType: existing.publicationVersion.publication
              .publicationType as PublicationType,
            observation,
          });
        }

        // Capture first: the bytes and their provenance are persisted before any
        // semantic record is derived from them.
        const captureRow = await tx.publicationRegistrationCapture.create({
          data: {
            registrationId: registration.id,
            captureKey: capture.captureKey,
            requestedManifestUrl: capture.requestedManifestUrl,
            resolvedManifestUrl: capture.resolvedManifestUrl,
            observedSiteRootUrl: capture.observedSiteRootUrl,
            manifestSha256: capture.manifestSha256,
            manifestProvenanceJson: JSON.stringify(manifestProvenance(capture.artifacts)),
            declaredSchemaVersion: capture.declaredSchemaVersion,
            adapterType: capture.adapterType,
            sourceLocalPublicationId: capture.sourceLocalPublicationId ?? null,
            sourcesSha256: capture.sourcesSha256,
            sourceDescriptorJson:
              capture.sourceDescriptor === undefined
                ? null
                : JSON.stringify(capture.sourceDescriptor),
            structuralProvenance: observation.structuralProvenance,
            sourceVerificationJson: JSON.stringify(observation.sourceVerification),
            warningsJson: JSON.stringify(observation.warnings),
            capturedAt,
          },
        });

        const publication = await tx.publication.upsert({
          where: { stableKey: normalized.publication.stableKey },
          update: {},
          create: {
            stableKey: normalized.publication.stableKey,
            publicationType: normalized.publication.publicationType,
            recordSource: normalized.publication.recordSource,
            identityEvidenceJson: JSON.stringify(normalized.publication.identityEvidence),
            sourceLocalPublicationId: normalized.publication.sourceLocalPublicationId ?? null,
          },
        });
        const publicationHadVersions =
          (await tx.publicationVersion.count({ where: { publicationId: publication.id } })) > 0;

        // An observed version is immutable, so a re-observation reuses the row it
        // already has rather than rewriting what ORAtlas previously saw.
        let version = await tx.publicationVersion.findUnique({
          where: { stableKey: normalized.version.stableKey },
        });
        const versionCreated = version === null;
        version ??= await tx.publicationVersion.create({
          data: {
            publicationId: publication.id,
            stableKey: normalized.version.stableKey,
            sourceLocalPublicationId: normalized.version.sourceLocalPublicationId ?? null,
            sourcesSha256: normalized.version.sourcesSha256,
            versionLabel: normalized.version.versionLabel ?? null,
            title: normalized.version.title ?? null,
            canonicalUrl: normalized.version.canonicalUrl ?? null,
            adapterType: normalized.version.adapter.type,
            adapterBindingJson: JSON.stringify(normalized.version.adapter),
            sourceDescriptorJson:
              normalized.version.source === undefined
                ? null
                : JSON.stringify(normalized.version.source),
            structuralProvenance: normalized.version.structuralProvenance,
            observedAt: new Date(normalized.version.observedAt),
          },
        });

        for (const artifact of capture.artifacts) {
          const alreadyRetained = await tx.publicationCapture.findUnique({
            where: {
              publicationVersionId_artifactKind_contentSha256: {
                publicationVersionId: version.id,
                artifactKind: artifact.kind,
                contentSha256: artifact.sha256,
              },
            },
            select: { id: true },
          });
          if (alreadyRetained !== null) continue;
          await tx.publicationCapture.create({
            data: {
              publicationVersionId: version.id,
              registrationCaptureId: captureRow.id,
              structuralProvenance: observation.structuralProvenance,
              ...artifactRow(artifact, capturedAt, JSON.stringify(artifact.provenance)),
            },
          });
        }

        for (const occurrence of normalized.occurrences) {
          const existingOccurrence = await tx.publicationClaimOccurrence.findUnique({
            where: { stableKey: occurrence.stableKey },
            select: { id: true },
          });
          if (existingOccurrence !== null) continue;
          await tx.publicationClaimOccurrence.create({
            data: {
              publicationVersionId: version.id,
              sourceLocalClaimId: occurrence.sourceLocalClaimId,
              stableKey: occurrence.stableKey,
              targetJson: JSON.stringify(occurrence.target),
              sourceBindingJson: JSON.stringify(occurrence.sourceBinding),
              selectorJson: JSON.stringify(occurrence.selector),
              declarationSha256: occurrence.declarationSha256,
              declarationAuthority: occurrence.declaration.authority,
              text:
                occurrence.declaration.authority === "publication-source"
                  ? occurrence.declaration.text
                  : null,
              claimType:
                occurrence.declaration.authority === "publication-source"
                  ? (occurrence.declaration.claimType ?? null)
                  : null,
              qualification:
                occurrence.declaration.authority === "publication-source"
                  ? (occurrence.declaration.qualification ?? null)
                  : null,
            },
          });
        }

        // The one permitted mutation of a capture: binding it, write-once, to the
        // version it materialized into.
        const boundCapture = await tx.publicationRegistrationCapture.update({
          where: { id: captureRow.id },
          data: { publicationVersionId: version.id },
        });

        return buildResult({
          disposition:
            versionCreated && publicationHadVersions ? "new-version-captured" : "captured",
          registration,
          captureRow: boundCapture,
          publicationId: publication.id,
          publicationVersionId: version.id,
          publicationStableKey: publication.stableKey,
          publicationType: publication.publicationType as PublicationType,
          observation,
        });
      }),
    (error) => error instanceof PublicationRegistrationServiceError,
  );
}

function manifestProvenance(artifacts: readonly CapturedArtifact[]): PublicationHttpProvenance {
  const manifest = artifacts.find((artifact) => artifact.kind === "publication-manifest");
  if (manifest === undefined) throw new Error("A capture always retains its manifest.");
  return manifest.provenance;
}

interface BuildResultInput {
  disposition: PublicationRegistrationResult["disposition"];
  registration: { id: string; manifestUrl: string };
  captureRow: { id: string; captureKey: string; capturedAt: Date };
  publicationId: string;
  publicationVersionId: string;
  publicationStableKey: string;
  publicationType: PublicationType;
  observation: PublicationObservation;
}

function buildResult(input: BuildResultInput): PublicationRegistrationResult {
  const { observation } = input;
  const { capture, normalized } = observation;

  return publicationRegistrationResultSchema.parse({
    schemaVersion: "1.0.0",
    disposition: input.disposition,
    registration: { id: input.registration.id, manifestUrl: input.registration.manifestUrl },
    capture: {
      id: input.captureRow.id,
      captureKey: input.captureRow.captureKey,
      requestedManifestUrl: capture.requestedManifestUrl,
      resolvedManifestUrl: capture.resolvedManifestUrl,
      manifestSha256: capture.manifestSha256,
      capturedAt: input.captureRow.capturedAt.toISOString(),
      manifestProvenance: manifestProvenance(capture.artifacts),
      artifacts: capture.artifacts.map((artifact) => ({
        kind: artifact.kind,
        ...(artifact.declaredPath === undefined ? {} : { declaredPath: artifact.declaredPath }),
        observedUrl: artifact.provenance.finalUrl,
        mediaType: artifact.mediaType,
        contentSha256: artifact.sha256,
        byteLength: artifact.byteLength,
        ...(artifact.declaredSha256 === undefined
          ? {}
          : { declaredSha256: artifact.declaredSha256 }),
      })),
    },
    publication: {
      id: input.publicationId,
      stableKey: input.publicationStableKey,
      publicationType: input.publicationType,
      ...(normalized.publication.sourceLocalPublicationId === undefined
        ? {}
        : { sourceLocalPublicationId: normalized.publication.sourceLocalPublicationId }),
    },
    publicationVersion: {
      id: input.publicationVersionId,
      stableKey: normalized.version.stableKey,
      sourcesSha256: normalized.version.sourcesSha256,
      ...(normalized.version.versionLabel === undefined
        ? {}
        : { versionLabel: normalized.version.versionLabel }),
      ...(normalized.version.title === undefined ? {} : { title: normalized.version.title }),
      ...(normalized.version.canonicalUrl === undefined
        ? {}
        : { canonicalUrl: normalized.version.canonicalUrl }),
    },
    manifestSchemaVersion: capture.declaredSchemaVersion,
    adapterType: capture.adapterType,
    claimOccurrenceCount: normalized.occurrences.length,
    structuralProvenance: observation.structuralProvenance,
    sourceVerification: observation.sourceVerification,
    warnings: observation.warnings,
    links: {
      publication: linkFor(`/api/publications/${input.publicationId}`),
      publicationVersion: linkFor(
        `/api/publications/${input.publicationId}/versions/${input.publicationVersionId}`,
      ),
      capture: linkFor(`/api/editorial/publications/captures/${input.captureRow.id}`),
    },
  });
}
