import "server-only";
import {
  canonicalJson,
  executionPassportRegistrationSchema,
  globalClaimId,
  type ExecutionPassportRegistration,
} from "@oratlas/contracts";
import {
  ExecutionPassportVerificationError,
  parseTrustedExecutionKeys,
  verifyExecutionPassport,
  type TrustedExecutionKey,
  type VerifiedExecutionPassport,
} from "@oratlas/execution-passports";
import { getServerEnv } from "@oratlas/config";
import { Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { prismaCode, withSqliteRetry } from "./db-retry";
import { isReadablePublicState } from "./review-lifecycle";

export class ExecutionPassportError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "not-found" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "ExecutionPassportError";
  }
}

export interface ExecutionPassportActor {
  id: string;
  role: string;
}

export interface PublicExecutionPassport {
  id: string;
  status: "execution-attested";
  verification: {
    verifiedAt: string;
    revision: number;
    structure: "verified";
    artifactDigests: "verified";
    signature: "verified";
    signingIdentity: "verified";
  };
  repository: { url: string; commitSha: string; treeSha: string };
  workflow: {
    entityId: string;
    path: string;
    sha256: string;
    runId: string;
    runAttempt: number;
  };
  signingIdentity: { keyId: string; issuer: string; subject: string };
  issuedAt: string;
  registeredAt: string;
  claims: Array<{
    claimId: string;
    versionId: string;
    localClaimId: string;
    reviewSlug: string;
    text: string;
    passportPath: string;
  }>;
  artifacts: Array<{
    entityId: string;
    role: "input" | "output";
    name: string;
    path: string;
    mediaType?: string;
    byteSize: number;
    sha256: string;
  }>;
  machineUrl: string;
  crate?: ExecutionPassportRegistration["crate"];
  attestation?: ExecutionPassportRegistration["attestation"];
  limitation: string;
}

type PassportRow = Prisma.ExecutionPassportGetPayload<{
  include: {
    artifacts: true;
    claims: {
      include: {
        claim: { include: { reviewVersion: { include: { review: true } } } };
      };
    };
  };
}>;

const PASSPORT_INCLUDE = Prisma.validator<Prisma.ExecutionPassportInclude>()({
  artifacts: { orderBy: [{ role: "asc" }, { entityId: "asc" }] },
  claims: {
    include: { claim: { include: { reviewVersion: { include: { review: true } } } } },
    orderBy: { claimId: "asc" },
  },
});

function trustedKeys(): TrustedExecutionKey[] {
  return parseTrustedExecutionKeys(getServerEnv().EXECUTION_PASSPORT_TRUSTED_KEYS_JSON);
}

function isEditor(actor: ExecutionPassportActor): boolean {
  return actor.role === "EDITOR" || actor.role === "ADMIN";
}

function verificationError(error: ExecutionPassportVerificationError): ExecutionPassportError {
  return new ExecutionPassportError(`Execution attestation rejected (${error.code}).`);
}

async function resolveClaims(verified: VerifiedExecutionPassport) {
  const rows = await prisma.claim.findMany({
    where: {
      OR: verified.claims.map((claim) => ({
        reviewVersionId: claim.versionId,
        localClaimId: claim.localClaimId,
      })),
    },
    include: { reviewVersion: { include: { review: true } } },
  });
  const byGlobalId = new Map(
    rows.map((row) => [globalClaimId(row.reviewVersionId, row.localClaimId), row]),
  );
  for (const binding of verified.claims) {
    const row = byGlobalId.get(binding.claimId);
    if (
      !row ||
      row.reviewVersion.review.status !== "published" ||
      !isReadablePublicState(row.reviewVersion.publicState)
    ) {
      throw new ExecutionPassportError(
        "Every execution binding must resolve to a readable immutable Atlas claim.",
        "not-found",
      );
    }
  }
  return verified.claims.map((binding) => byGlobalId.get(binding.claimId)!);
}

/** Register only after complete offline verification and claim resolution. */
export async function registerExecutionPassport(
  actor: ExecutionPassportActor,
  input: ExecutionPassportRegistration,
): Promise<{ id: string; status: "execution-attested"; verificationRevision: number }> {
  if (!isEditor(actor)) {
    throw new ExecutionPassportError(
      "Editor role required to register execution attestations.",
      "forbidden",
    );
  }
  const parsed = executionPassportRegistrationSchema.parse(input);
  let verified: VerifiedExecutionPassport;
  try {
    verified = verifyExecutionPassport(parsed, trustedKeys());
  } catch (error) {
    if (error instanceof ExecutionPassportVerificationError) throw verificationError(error);
    throw error;
  }
  const claims = await resolveClaims(verified);
  const existing = await prisma.executionPassport.findUnique({
    where: { payloadSha256: verified.payloadSha256 },
    select: { id: true },
  });
  if (existing) {
    throw new ExecutionPassportError(
      "This execution attestation is already registered.",
      "conflict",
    );
  }

  try {
    return await withSqliteRetry(
      () =>
        prisma.$transaction(
          async (tx) => {
            const passport = await tx.executionPassport.create({
              data: {
                status: verified.status,
                verificationStatus: "verified",
                sourceJson: canonicalJson(parsed),
                crateSha256: verified.crateSha256,
                attestationSha256: verified.attestationSha256,
                payloadSha256: verified.payloadSha256,
                repositoryUrl: verified.repository.url,
                commitSha: verified.repository.commitSha,
                treeSha: verified.repository.treeSha,
                workflowEntityId: verified.workflow.entityId,
                workflowPath: verified.workflow.path,
                workflowSha256: verified.workflow.sha256,
                workflowRunId: verified.workflow.runId,
                workflowRunAttempt: verified.workflow.runAttempt,
                signingKeyId: verified.signingIdentity.keyId,
                signingIssuer: verified.signingIdentity.issuer,
                signingSubject: verified.signingIdentity.subject,
                issuedAt: new Date(verified.issuedAt),
                registeredById: actor.id,
                lastVerifiedById: actor.id,
                claims: { create: claims.map((claim) => ({ claimId: claim.id })) },
                artifacts: {
                  create: verified.artifacts.map((artifact) => ({
                    entityId: artifact.entityId,
                    role: artifact.role,
                    name: artifact.name,
                    path: artifact.path,
                    mediaType: artifact.mediaType,
                    byteSize: artifact.byteSize,
                    sha256: artifact.sha256,
                  })),
                },
              },
            });
            await tx.auditEvent.create({
              data: {
                actorId: actor.id,
                action: "execution-passport.registered",
                subjectType: "execution-passport",
                subjectId: passport.id,
                detailsJson: canonicalJson({
                  status: verified.status,
                  attestationSha256: verified.attestationSha256,
                  claimCount: claims.length,
                  artifactCount: verified.artifacts.length,
                  signingKeyId: verified.signingIdentity.keyId,
                }),
              },
            });
            return { id: passport.id, status: verified.status, verificationRevision: 0 };
          },
          { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
        ),
      (error) => error instanceof ExecutionPassportError,
    );
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      throw new ExecutionPassportError(
        "This execution attestation is already registered.",
        "conflict",
      );
    }
    throw error;
  }
}

function parseSource(row: Pick<PassportRow, "sourceJson">): ExecutionPassportRegistration {
  try {
    return executionPassportRegistrationSchema.parse(JSON.parse(row.sourceJson));
  } catch {
    throw new ExecutionPassportError("Stored execution attestation is malformed.", "conflict");
  }
}

function materializedRowMatches(row: PassportRow, verified: VerifiedExecutionPassport): boolean {
  const claims = row.claims.map((binding) =>
    globalClaimId(binding.claim.reviewVersionId, binding.claim.localClaimId),
  );
  const artifacts = row.artifacts
    .map((artifact) => ({
      entityId: artifact.entityId,
      role: artifact.role,
      name: artifact.name,
      path: artifact.path,
      mediaType: artifact.mediaType ?? undefined,
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
    }))
    .sort((left, right) => left.entityId.localeCompare(right.entityId));
  return (
    row.status === verified.status &&
    row.crateSha256 === verified.crateSha256 &&
    row.attestationSha256 === verified.attestationSha256 &&
    row.payloadSha256 === verified.payloadSha256 &&
    row.repositoryUrl === verified.repository.url &&
    row.commitSha === verified.repository.commitSha &&
    row.treeSha === verified.repository.treeSha &&
    row.workflowEntityId === verified.workflow.entityId &&
    row.workflowPath === verified.workflow.path &&
    row.workflowSha256 === verified.workflow.sha256 &&
    row.workflowRunId === verified.workflow.runId &&
    row.workflowRunAttempt === verified.workflow.runAttempt &&
    row.signingKeyId === verified.signingIdentity.keyId &&
    row.signingIssuer === verified.signingIdentity.issuer &&
    row.signingSubject === verified.signingIdentity.subject &&
    row.issuedAt.getTime() === new Date(verified.issuedAt).getTime() &&
    canonicalJson([...claims].sort()) ===
      canonicalJson(verified.claims.map((claim) => claim.claimId).sort()) &&
    canonicalJson(artifacts) ===
      canonicalJson(
        [...verified.artifacts].sort((left, right) => left.entityId.localeCompare(right.entityId)),
      )
  );
}

function verifyStored(row: PassportRow): {
  source: ExecutionPassportRegistration;
  verified: VerifiedExecutionPassport;
} {
  if (row.verificationStatus !== "verified") {
    throw new ExecutionPassportError("Execution passport is not currently verified.", "conflict");
  }
  const source = parseSource(row);
  let verified: VerifiedExecutionPassport;
  try {
    verified = verifyExecutionPassport(source, trustedKeys());
  } catch (error) {
    if (error instanceof ExecutionPassportVerificationError) throw verificationError(error);
    throw error;
  }
  if (!materializedRowMatches(row, verified)) {
    throw new ExecutionPassportError(
      "Stored execution passport integrity check failed.",
      "conflict",
    );
  }
  return { source, verified };
}

/** Re-run verification against the current offline trust policy using CAS. */
export async function reverifyExecutionPassport(
  actor: ExecutionPassportActor,
  passportId: string,
  expectedRevision: number,
): Promise<{ id: string; status: "execution-attested"; verificationRevision: number }> {
  if (!isEditor(actor)) {
    throw new ExecutionPassportError(
      "Editor role required to verify execution attestations.",
      "forbidden",
    );
  }
  const row = await prisma.executionPassport.findUnique({
    where: { id: passportId },
    include: PASSPORT_INCLUDE,
  });
  if (!row) throw new ExecutionPassportError("Execution passport not found.", "not-found");
  if (row.revision !== expectedRevision) {
    throw new ExecutionPassportError(
      "Execution passport was verified by another editor.",
      "conflict",
    );
  }

  let verified: VerifiedExecutionPassport;
  try {
    verified = verifyExecutionPassport(parseSource(row), trustedKeys());
    await resolveClaims(verified);
    if (!materializedRowMatches(row, verified)) {
      throw new ExecutionPassportError(
        "Stored execution passport integrity check failed.",
        "conflict",
      );
    }
  } catch (error) {
    const reason =
      error instanceof ExecutionPassportVerificationError
        ? error.code
        : error instanceof ExecutionPassportError
          ? error.code
          : "internal-error";
    await prisma.$transaction(async (tx) => {
      const changed = await tx.executionPassport.updateMany({
        where: { id: passportId, revision: expectedRevision },
        data: {
          verificationStatus: "failed",
          revision: { increment: 1 },
          lastVerifiedById: actor.id,
        },
      });
      if (changed.count !== 1) return;
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "execution-passport.verification-failed",
          subjectType: "execution-passport",
          subjectId: passportId,
          detailsJson: canonicalJson({ reason }),
        },
      });
    });
    if (error instanceof ExecutionPassportVerificationError) throw verificationError(error);
    throw error;
  }
  const verifiedAt = new Date();
  return prisma.$transaction(
    async (tx) => {
      const changed = await tx.executionPassport.updateMany({
        where: { id: passportId, revision: expectedRevision },
        data: {
          verificationStatus: "verified",
          verifiedAt,
          lastVerifiedById: actor.id,
          revision: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new ExecutionPassportError(
          "Execution passport was verified by another editor.",
          "conflict",
        );
      }
      await tx.auditEvent.create({
        data: {
          actorId: actor.id,
          action: "execution-passport.verified",
          subjectType: "execution-passport",
          subjectId: passportId,
          detailsJson: canonicalJson({
            attestationSha256: verified.attestationSha256,
            signingKeyId: verified.signingIdentity.keyId,
            revision: expectedRevision + 1,
          }),
        },
      });
      return {
        id: passportId,
        status: verified.status,
        verificationRevision: expectedRevision + 1,
      };
    },
    { maxWait: 5_000, timeout: 15_000, isolationLevel: "Serializable" },
  );
}

function publicDto(
  row: PassportRow,
  source: ExecutionPassportRegistration,
  verified: VerifiedExecutionPassport,
  includeSource: boolean,
): PublicExecutionPassport | null {
  if (
    row.claims.some(
      (binding) =>
        binding.claim.reviewVersion.review.status !== "published" ||
        !isReadablePublicState(binding.claim.reviewVersion.publicState),
    )
  ) {
    return null;
  }
  return {
    id: row.id,
    status: verified.status,
    verification: {
      verifiedAt: row.verifiedAt.toISOString(),
      revision: row.revision,
      ...verified.checks,
    },
    repository: verified.repository,
    workflow: verified.workflow,
    signingIdentity: verified.signingIdentity,
    issuedAt: verified.issuedAt,
    registeredAt: row.registeredAt.toISOString(),
    claims: row.claims.map((binding) => ({
      claimId: globalClaimId(binding.claim.reviewVersionId, binding.claim.localClaimId),
      versionId: binding.claim.reviewVersionId,
      localClaimId: binding.claim.localClaimId,
      reviewSlug: binding.claim.reviewVersion.review.slug,
      text: binding.claim.text,
      passportPath: `/claims/${binding.claim.reviewVersionId}/${encodeURIComponent(binding.claim.localClaimId)}`,
    })),
    artifacts: verified.artifacts,
    machineUrl: `/api/execution-passports/${row.id}`,
    ...(includeSource ? { crate: source.crate, attestation: source.attestation } : {}),
    limitation:
      "Execution-attested means exact provenance and a trusted signature were verified offline; it does not mean the workflow was rerun, reproduced, or that any claim is true.",
  };
}

async function verifiedPublicRows(rows: PassportRow[], includeSource: boolean) {
  const output: PublicExecutionPassport[] = [];
  for (const row of rows) {
    try {
      const { source, verified } = verifyStored(row);
      const dto = publicDto(row, source, verified, includeSource);
      if (dto) output.push(dto);
    } catch {
      // Public boundary fails closed: invalid, stale-trust, or internally
      // inconsistent attestations are omitted instead of downgraded silently.
    }
  }
  return output;
}

export async function getPublicExecutionPassport(
  id: string,
): Promise<PublicExecutionPassport | null> {
  const row = await prisma.executionPassport.findUnique({
    where: { id },
    include: PASSPORT_INCLUDE,
  });
  if (!row) return null;
  return (await verifiedPublicRows([row], true))[0] ?? null;
}

export async function listExecutionPassportsForClaim(
  versionId: string,
  localClaimId: string,
): Promise<PublicExecutionPassport[]> {
  const rows = await prisma.executionPassport.findMany({
    where: {
      verificationStatus: "verified",
      claims: { some: { claim: { reviewVersionId: versionId, localClaimId } } },
    },
    include: PASSPORT_INCLUDE,
    orderBy: { registeredAt: "desc" },
    take: 50,
  });
  return verifiedPublicRows(rows, false);
}

export async function listExecutionPassportsForVersion(
  versionId: string,
): Promise<PublicExecutionPassport[]> {
  const rows = await prisma.executionPassport.findMany({
    where: {
      verificationStatus: "verified",
      claims: { some: { claim: { reviewVersionId: versionId } } },
    },
    include: PASSPORT_INCLUDE,
    orderBy: { registeredAt: "desc" },
    take: 100,
  });
  return verifiedPublicRows(rows, false);
}
