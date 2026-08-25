import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  canonicalJson,
  createVerificationProtocolSchema,
  createVerificationRunSchema,
  submitVerificationFindingSchema,
  VERIFICATION_API_SCHEMA_VERSION,
  VERIFICATION_ARTIFACT_MAX_BYTES,
  VERIFICATION_INPUT_PROFILE_VERSION,
  type CreateVerificationProtocol,
  type CreateVerificationRun,
  type SubmitVerificationFinding,
  type VerificationEvidenceReference,
} from "@oratlas/contracts";
import { Prisma, type VerificationArtifact, type VerificationRun } from "@oratlas/db";
import { prisma } from "./db";
import {
  getPublicationVersionPacket,
  PublicationVersionPacketError,
} from "./publication-version-packet";

export type VerificationErrorCode =
  "unauthorized" | "forbidden" | "not-found" | "conflict" | "bad-request" | "payload-too-large";

export class VerificationError extends Error {
  constructor(
    public readonly code: VerificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VerificationError";
  }
}

export type VerifierAuth = { credentialId: string; verifierId: string };
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const prismaCode = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError ? error.code : undefined;

async function concurrencyConflict<T>(operation: Promise<T>, message: string): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    if (["P2002", "P2025", "P2034"].includes(prismaCode(error) ?? ""))
      throw new VerificationError("conflict", message);
    throw error;
  }
}

const verifierPublic = (row: {
  id: string;
  slug: string;
  name: string;
  description: string;
  publicUrl: string | null;
  status: string;
  createdAt: Date;
}) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  publicUrl: row.publicUrl,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  href: `/api/verifiers/${row.id}`,
});

export async function listVerifiers() {
  const rows = await prisma.verifier.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] });
  return { schemaVersion: VERIFICATION_API_SCHEMA_VERSION, verifiers: rows.map(verifierPublic) };
}

export async function getVerifier(id: string) {
  const row = await prisma.verifier.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!row) throw new VerificationError("not-found", "Verifier not found.");
  return verifierPublic(row);
}

export async function createVerifier(raw: unknown, actorId: string) {
  const input = (await import("@oratlas/contracts")).createVerifierSchema.parse(raw);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.verifier.create({
        data: { ...input, createdById: actorId, activatedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: "verification.verifier-created",
          subjectType: "verifier",
          subjectId: created.id,
          detailsJson: canonicalJson({ slug: created.slug }),
        },
      });
      return created;
    });
    return verifierPublic(row);
  } catch (error) {
    if (prismaCode(error) === "P2002")
      throw new VerificationError("conflict", "Verifier slug already exists.");
    throw error;
  }
}

export async function setVerifierStatus(
  id: string,
  status: "active" | "suspended" | "retired",
  actorId: string,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.verifier.findUnique({ where: { id } });
    if (!existing) throw new VerificationError("not-found", "Verifier not found.");
    if (existing.status === status) return verifierPublic(existing);
    if (existing.status === "retired")
      throw new VerificationError("conflict", "A retired verifier cannot be reactivated.");
    const now = new Date();
    const row = await tx.verifier.update({
      where: { id },
      data: {
        status,
        activatedAt: status === "active" ? (existing.activatedAt ?? now) : existing.activatedAt,
        retiredAt: status === "retired" ? now : existing.retiredAt,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "verification.verifier-status",
        subjectType: "verifier",
        subjectId: id,
        detailsJson: canonicalJson({ previous: existing.status, status }),
      },
    });
    return verifierPublic(row);
  });
}

export async function issueVerifierCredential(
  verifierId: string,
  input: { label: string; scopes: string[]; expiresAt?: string },
  actorId: string,
) {
  const verifier = await prisma.verifier.findUnique({ where: { id: verifierId } });
  if (!verifier) throw new VerificationError("not-found", "Verifier not found.");
  if (verifier.status !== "active")
    throw new VerificationError("conflict", "Only an active verifier may receive credentials.");
  const prefix = randomBytes(9).toString("base64url");
  const token = `oratlas_verify_${prefix}.${randomBytes(32).toString("base64url")}`;
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.verifierCredential.create({
      data: {
        verifierId,
        label: input.label,
        tokenPrefix: prefix,
        tokenHash: digest(token),
        scopesJson: canonicalJson([...new Set(input.scopes)].sort()),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        issuedById: actorId,
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "verification.credential-issued",
        subjectType: "verifier-credential",
        subjectId: created.id,
        detailsJson: canonicalJson({
          verifierId,
          label: created.label,
          scopes: JSON.parse(created.scopesJson),
          expiresAt: created.expiresAt?.toISOString() ?? null,
        }),
      },
    });
    return created;
  });
  return {
    id: row.id,
    verifierId,
    label: row.label,
    scopes: JSON.parse(row.scopesJson),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    token,
  };
}

export async function revokeVerifierCredential(id: string, actorId: string) {
  const row = await prisma.verifierCredential.findUnique({ where: { id } });
  if (!row) throw new VerificationError("not-found", "Verifier credential not found.");
  if (!row.revokedAt)
    await prisma.verifierCredential.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById: actorId },
    });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "verification.credential-revoked",
      subjectType: "verifier-credential",
      subjectId: id,
      detailsJson: canonicalJson({ verifierId: row.verifierId }),
    },
  });
}

export async function authenticateVerifier(
  request: Request,
  scope: "verification:read" | "verification:submit",
): Promise<VerifierAuth> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const match = /^oratlas_verify_([A-Za-z0-9_-]{12})\.[A-Za-z0-9_-]+$/.exec(token);
  if (!match)
    throw new VerificationError("unauthorized", "A valid verifier bearer credential is required.");
  const row = await prisma.verifierCredential.findUnique({
    where: { tokenPrefix: match[1] },
    include: { verifier: true },
  });
  const supplied = Buffer.from(digest(token), "hex");
  const stored = row ? Buffer.from(row.tokenHash, "hex") : Buffer.alloc(32);
  if (!row || supplied.length !== stored.length || !timingSafeEqual(supplied, stored))
    throw new VerificationError("unauthorized", "A valid verifier bearer credential is required.");
  if (row.revokedAt || (row.expiresAt && row.expiresAt <= new Date()))
    throw new VerificationError("unauthorized", "The verifier credential is revoked or expired.");
  if (row.verifier.status !== "active")
    throw new VerificationError("forbidden", "The verifier is not active.");
  const scopes = JSON.parse(row.scopesJson) as string[];
  if (!scopes.includes(scope))
    throw new VerificationError("forbidden", `Credential lacks ${scope} scope.`);
  await prisma.verifierCredential.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return { credentialId: row.id, verifierId: row.verifierId };
}

function protocolPublic(row: {
  id: string;
  authorityVerifierId: string;
  seriesKey: string;
  protocolVersion: string;
  title: string;
  description: string;
  verificationType: string;
  executionMode: string;
  supportedSubjectTypesJson: string;
  definitionJson: string;
  definitionSha256: string;
  status: string;
  supersedesProtocolId: string | null;
  createdAt: Date;
  authority?: { id: string; slug: string; name: string };
}) {
  return {
    id: row.id,
    authorityVerifierId: row.authorityVerifierId,
    authority: row.authority,
    seriesKey: row.seriesKey,
    protocolVersion: row.protocolVersion,
    title: row.title,
    description: row.description,
    verificationType: row.verificationType,
    executionMode: row.executionMode,
    supportedSubjectTypes: JSON.parse(row.supportedSubjectTypesJson),
    definition: JSON.parse(row.definitionJson),
    definitionSha256: row.definitionSha256,
    status: row.status,
    supersedesProtocolId: row.supersedesProtocolId,
    createdAt: row.createdAt.toISOString(),
    href: `/api/verification-protocols/${row.id}`,
  };
}

export async function listVerificationProtocols() {
  const rows = await prisma.verificationProtocol.findMany({
    include: { authority: { select: { id: true, slug: true, name: true } } },
    orderBy: [{ seriesKey: "asc" }, { protocolVersion: "asc" }],
  });
  return { schemaVersion: VERIFICATION_API_SCHEMA_VERSION, protocols: rows.map(protocolPublic) };
}

export async function getVerificationProtocol(id: string) {
  const row = await prisma.verificationProtocol.findUnique({
    where: { id },
    include: { authority: { select: { id: true, slug: true, name: true } } },
  });
  if (!row) throw new VerificationError("not-found", "Verification protocol not found.");
  return protocolPublic(row);
}

export async function createVerificationProtocol(raw: CreateVerificationProtocol, actorId: string) {
  const input = createVerificationProtocolSchema.parse(raw);
  const authority = await prisma.verifier.findUnique({ where: { id: input.authorityVerifierId } });
  if (!authority) throw new VerificationError("not-found", "Protocol authority not found.");
  if (authority.status !== "active")
    throw new VerificationError("conflict", "Protocol authority is not active.");
  if (input.supersedesProtocolId) {
    const prior = await prisma.verificationProtocol.findUnique({
      where: { id: input.supersedesProtocolId },
    });
    if (
      !prior ||
      prior.authorityVerifierId !== input.authorityVerifierId ||
      prior.seriesKey !== input.seriesKey
    )
      throw new VerificationError(
        "conflict",
        "Supersession must remain within one authority and protocol series.",
      );
  }
  const definitionJson = canonicalJson(input.definition);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.verificationProtocol.create({
        data: {
          authorityVerifierId: input.authorityVerifierId,
          seriesKey: input.seriesKey,
          protocolVersion: input.protocolVersion,
          title: input.title,
          description: input.description,
          verificationType: input.verificationType,
          executionMode: input.executionMode,
          supportedSubjectTypesJson: canonicalJson([...input.supportedSubjectTypes].sort()),
          definitionJson,
          definitionSha256: digest(definitionJson),
          supersedesProtocolId: input.supersedesProtocolId,
        },
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: "verification.protocol-created",
          subjectType: "verification-protocol",
          subjectId: created.id,
          detailsJson: canonicalJson({
            seriesKey: created.seriesKey,
            version: created.protocolVersion,
          }),
        },
      });
      return created;
    });
    return protocolPublic(row);
  } catch (error) {
    if (prismaCode(error) === "P2002")
      throw new VerificationError("conflict", "Verification protocol version already exists.");
    throw error;
  }
}

export async function retireVerificationProtocol(id: string, actorId: string) {
  const existing = await prisma.verificationProtocol.findUnique({ where: { id } });
  if (!existing) throw new VerificationError("not-found", "Verification protocol not found.");
  if (existing.status === "retired") return protocolPublic(existing);
  const row = await prisma.verificationProtocol.update({
    where: { id },
    data: { status: "retired" },
  });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "verification.protocol-retired",
      subjectType: "verification-protocol",
      subjectId: id,
      detailsJson: canonicalJson({ definitionSha256: row.definitionSha256 }),
    },
  });
  return protocolPublic(row);
}

function blindedPacket(packet: Awaited<ReturnType<typeof getPublicationVersionPacket>>) {
  const {
    contributors: _contributorsLink,
    productionProvenance: _provenanceLink,
    ...links
  } = packet.links;
  const transformed = {
    ...packet,
    schemaVersion: "verification-publication-input/1.0.0" as const,
    sourcePacketSchemaVersion: packet.schemaVersion,
    contributors: [],
    productionProvenance: [],
    links,
  };
  const { sha256: _oldSha256, ...withoutDigest } = transformed;
  return { ...withoutDigest, sha256: digest(canonicalJson(withoutDigest)) };
}

async function verificationPacket(publicationVersionId: string) {
  try {
    return await getPublicationVersionPacket(publicationVersionId);
  } catch (error) {
    if (!(error instanceof PublicationVersionPacketError)) throw error;
    throw new VerificationError(
      /not found/i.test(error.message) ? "not-found" : "conflict",
      `Verification input could not be frozen: ${error.message}`,
    );
  }
}

async function captureInput(input: CreateVerificationRun) {
  if (input.subject.type === "publication-version") {
    const packet = await verificationPacket(input.subject.publicationVersionId);
    const value = input.inputProfile === "blinded-scientific" ? blindedPacket(packet) : packet;
    return { schemaVersion: value.schemaVersion, value };
  }
  if (input.subject.type === "publication-claim-occurrence") {
    const occurrence = await prisma.publicationClaimOccurrence.findUnique({
      where: { id: input.subject.publicationClaimOccurrenceId },
      select: { id: true, publicationVersionId: true },
    });
    if (!occurrence)
      throw new VerificationError("not-found", "Publication claim occurrence not found.");
    const packet = await verificationPacket(occurrence.publicationVersionId);
    const projected = input.inputProfile === "blinded-scientific" ? blindedPacket(packet) : packet;
    const selected = projected.occurrences.find((item) => item.id === occurrence.id);
    if (!selected)
      throw new VerificationError(
        "conflict",
        "Occurrence is outside the bounded publication packet.",
      );
    return {
      schemaVersion: "verification-claim-input/1.0.0",
      value: {
        schemaVersion: "verification-claim-input/1.0.0",
        subject: { type: "publication-claim-occurrence", id: occurrence.id },
        publicationVersion: projected.version,
        occurrence: selected,
        captures: projected.captures,
        content: projected.content,
        relations: projected.relations,
        completeness: projected.completeness,
      },
    };
  }
  const version = await prisma.knowledgeNodeVersion.findUnique({
    where: { id: input.subject.knowledgeNodeVersionId },
    include: {
      knowledgeNode: { select: { id: true, kind: true, originType: true, stableKey: true } },
      sourcePublicationClaimOccurrence: {
        select: { id: true, publicationVersionId: true },
      },
    },
  });
  if (!version) throw new VerificationError("not-found", "Knowledge node version not found.");
  let publicationContext = null;
  if (version.sourcePublicationClaimOccurrence) {
    const packet = await verificationPacket(
      version.sourcePublicationClaimOccurrence.publicationVersionId,
    );
    const projected = input.inputProfile === "blinded-scientific" ? blindedPacket(packet) : packet;
    const selectedOccurrence = projected.occurrences.find(
      (item) => item.id === version.sourcePublicationClaimOccurrence!.id,
    );
    if (!selectedOccurrence)
      throw new VerificationError(
        "conflict",
        "Knowledge node source occurrence is outside the bounded publication packet.",
      );
    publicationContext = {
      publicationVersion: projected.version,
      occurrence: selectedOccurrence,
      captures: projected.captures,
      content: projected.content,
      productionProvenance: projected.productionProvenance,
      relations: projected.relations,
      completeness: projected.completeness,
    };
  }
  const value = {
    schemaVersion: "verification-node-version-input/1.0.0",
    subject: { type: "knowledge-node-version", id: version.id },
    node: version.knowledgeNode,
    version: {
      id: version.id,
      knowledgeNodeId: version.knowledgeNodeId,
      capturePayloadHash: version.capturePayloadHash,
      title: version.title,
      abstract: version.abstract,
      text: version.text,
      contributors:
        input.inputProfile === "blinded-scientific" ? [] : JSON.parse(version.contributorsJson),
      license: version.license,
      provenance: JSON.parse(version.provenanceJson),
      payload: JSON.parse(version.payloadJson),
      versionDoi: version.versionDoi,
      conceptDoi: version.conceptDoi,
      createdAt: version.createdAt.toISOString(),
    },
    publicationContext,
  };
  return { schemaVersion: value.schemaVersion, value };
}

function subjectColumns(subject: CreateVerificationRun["subject"]) {
  return {
    publicationVersionId:
      subject.type === "publication-version" ? subject.publicationVersionId : null,
    publicationClaimOccurrenceId:
      subject.type === "publication-claim-occurrence" ? subject.publicationClaimOccurrenceId : null,
    knowledgeNodeVersionId:
      subject.type === "knowledge-node-version" ? subject.knowledgeNodeVersionId : null,
  };
}

function runSubject(row: VerificationRun) {
  if (row.publicationVersionId)
    return { type: "publication-version" as const, publicationVersionId: row.publicationVersionId };
  if (row.publicationClaimOccurrenceId)
    return {
      type: "publication-claim-occurrence" as const,
      publicationClaimOccurrenceId: row.publicationClaimOccurrenceId,
    };
  return {
    type: "knowledge-node-version" as const,
    knowledgeNodeVersionId: row.knowledgeNodeVersionId!,
  };
}

function runPublic(row: VerificationRun, replayed = false) {
  return {
    id: row.id,
    verificationProtocolId: row.protocolId,
    subject: runSubject(row),
    claimedVerifierId: row.claimedVerifierId,
    status: row.status,
    input: {
      profile: row.inputProfile,
      profileVersion: row.inputProfileVersion,
      schemaVersion: row.inputSchemaVersion,
      sha256: row.inputSha256,
      capturedAt: row.inputCapturedAt.toISOString(),
    },
    requestedAt: row.requestedAt.toISOString(),
    claimedAt: row.claimedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    terminalReason: row.terminalReason,
    provenance: {
      agentRunId: row.agentRunId,
      executionPassportId: row.executionPassportId,
      replicationBriefId: row.replicationBriefId,
    },
    replayed,
    links: {
      self: `/api/verification-runs/${row.id}`,
      claim: `/api/verification-runs/${row.id}/claim`,
      input: `/api/verification-runs/${row.id}/input`,
      findings: `/api/verification-runs/${row.id}/findings`,
      transition: `/api/verification-runs/${row.id}/transition`,
    },
  };
}

function sameRunRequest(row: VerificationRun, input: CreateVerificationRun) {
  const subject = subjectColumns(input.subject);
  return (
    row.protocolId === input.verificationProtocolId &&
    row.publicationVersionId === subject.publicationVersionId &&
    row.publicationClaimOccurrenceId === subject.publicationClaimOccurrenceId &&
    row.knowledgeNodeVersionId === subject.knowledgeNodeVersionId &&
    row.inputProfile === input.inputProfile &&
    row.inputProfileVersion === input.inputProfileVersion &&
    row.replicationBriefId === (input.replicationBriefId ?? null) &&
    row.agentRunId === (input.agentRunId ?? null) &&
    row.executionPassportId === (input.executionPassportId ?? null)
  );
}

export async function createVerificationRun(raw: CreateVerificationRun, actorId: string) {
  const input = createVerificationRunSchema.parse(raw);
  const existing = await prisma.verificationRun.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) {
    if (!sameRunRequest(existing, input))
      throw new VerificationError(
        "conflict",
        "Idempotency key is bound to another verification request.",
      );
    return runPublic(existing, true);
  }
  const protocol = await prisma.verificationProtocol.findUnique({
    where: { id: input.verificationProtocolId },
  });
  if (!protocol) throw new VerificationError("not-found", "Verification protocol not found.");
  if (protocol.status !== "active")
    throw new VerificationError("conflict", "Verification protocol is retired.");
  const supported = JSON.parse(protocol.supportedSubjectTypesJson) as string[];
  if (!supported.includes(input.subject.type))
    throw new VerificationError(
      "bad-request",
      "Protocol does not support this exact subject type.",
    );
  const captured = await captureInput(input);
  const inputJson = canonicalJson(captured.value);
  const now = new Date();
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.verificationRun.create({
        data: {
          protocolId: protocol.id,
          ...subjectColumns(input.subject),
          inputProfile: input.inputProfile,
          inputProfileVersion: VERIFICATION_INPUT_PROFILE_VERSION,
          inputSchemaVersion: captured.schemaVersion,
          inputJson,
          inputSha256: digest(inputJson),
          inputCapturedAt: now,
          idempotencyKey: input.idempotencyKey,
          requestedById: actorId,
          requestedAt: now,
          agentRunId: input.agentRunId,
          executionPassportId: input.executionPassportId,
          replicationBriefId: input.replicationBriefId,
        },
      });
      await tx.verificationRunLifecycleEvent.create({
        data: {
          verificationRunId: created.id,
          kind: "requested",
          actorUserId: actorId,
          detailsJson: "{}",
        },
      });
      return created;
    });
    return runPublic(row);
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      const raced = await prisma.verificationRun.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (raced && sameRunRequest(raced, input)) return runPublic(raced, true);
      throw new VerificationError(
        "conflict",
        "Idempotency key is bound to another verification request.",
      );
    }
    throw error;
  }
}

export async function getVerificationRun(id: string) {
  const row = await prisma.verificationRun.findUnique({
    where: { id },
    include: {
      protocol: { include: { authority: { select: { id: true, slug: true, name: true } } } },
      claimedVerifier: { select: { id: true, slug: true, name: true } },
      artifacts: { where: { status: "completed" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      findings: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      lifecycleEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!row) throw new VerificationError("not-found", "Verification run not found.");
  return {
    ...runPublic(row),
    protocol: protocolPublic(row.protocol),
    verifier: row.claimedVerifier,
    artifacts: row.artifacts.map(artifactPublic),
    findings: row.findings.map(findingPublic),
    lifecycle: row.lifecycleEvents.map((event) => ({
      kind: event.kind,
      actorUserId: event.actorUserId,
      actorVerifierId: event.actorVerifierId,
      details: JSON.parse(event.detailsJson),
      createdAt: event.createdAt.toISOString(),
    })),
    limitations: [
      "Verification evidence is protocol-scoped and does not establish universal scientific truth.",
      "Execution attestation is not, by itself, independent reproduction.",
    ],
  };
}

export async function claimVerificationRun(id: string, auth: VerifierAuth, leaseSeconds: number) {
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1_000);
  const leaseToken = `oratlas_lease_${randomBytes(32).toString("base64url")}`;
  const current = await prisma.verificationRun.findUnique({ where: { id } });
  if (!current) throw new VerificationError("not-found", "Verification run not found.");
  if (["completed", "failed", "cancelled"].includes(current.status))
    throw new VerificationError("conflict", "Terminal verification runs cannot be claimed.");
  if (current.leaseExpiresAt && current.leaseExpiresAt > now)
    throw new VerificationError("conflict", "Verification run already has an active lease.");
  const reclaimed = current.status !== "requested";
  const changed = await concurrencyConflict(
    prisma.$transaction(async (tx) => {
      const update = await tx.verificationRun.updateMany({
        where: {
          id,
          status: { in: ["requested", "claimed", "running"] },
          OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
        },
        data: {
          status: "claimed",
          claimedVerifierId: auth.verifierId,
          claimedAt: now,
          startedAt: null,
          leaseTokenHash: digest(leaseToken),
          leaseIssuedAt: now,
          leaseExpiresAt,
          leaseGeneration: { increment: 1 },
          terminalReason: null,
        },
      });
      if (update.count !== 1) return null;
      const row = await tx.verificationRun.findUniqueOrThrow({ where: { id } });
      await tx.verificationRunLifecycleEvent.create({
        data: {
          verificationRunId: id,
          kind: reclaimed ? "reclaimed" : "claimed",
          actorVerifierId: auth.verifierId,
          detailsJson: canonicalJson({
            credentialId: auth.credentialId,
            leaseGeneration: row.leaseGeneration,
            leaseExpiresAt: leaseExpiresAt.toISOString(),
          }),
        },
      });
      return row;
    }),
    "Verification run was claimed or changed concurrently.",
  );
  if (!changed)
    throw new VerificationError(
      "conflict",
      "Verification run was claimed or changed concurrently.",
    );
  return { ...runPublic(changed), leaseToken, leaseExpiresAt: leaseExpiresAt.toISOString() };
}

export async function requireVerificationLease(
  request: Request,
  runId: string,
  auth: VerifierAuth,
) {
  const token = request.headers.get("x-oratlas-verification-lease") ?? "";
  const row = await prisma.verificationRun.findUnique({ where: { id: runId } });
  if (!row) throw new VerificationError("not-found", "Verification run not found.");
  const supplied = Buffer.from(digest(token), "hex");
  const stored = row.leaseTokenHash ? Buffer.from(row.leaseTokenHash, "hex") : Buffer.alloc(32);
  if (
    !token.startsWith("oratlas_lease_") ||
    supplied.length !== stored.length ||
    !timingSafeEqual(supplied, stored) ||
    row.claimedVerifierId !== auth.verifierId ||
    !row.leaseExpiresAt ||
    row.leaseExpiresAt <= new Date() ||
    !["claimed", "running"].includes(row.status)
  )
    throw new VerificationError(
      "forbidden",
      "A valid active lease for this verifier and run is required.",
    );
  return row;
}

export async function getVerificationInput(id: string, auth: VerifierAuth, request: Request) {
  const row = await requireVerificationLease(request, id, auth);
  if (digest(row.inputJson) !== row.inputSha256)
    throw new VerificationError(
      "conflict",
      "Frozen verification input failed its integrity check.",
    );
  const captureIds = [...(frozenEvidenceIndex(row).get("capture") ?? [])];
  const captures = captureIds.length
    ? await prisma.publicationCapture.findMany({
        where: { id: { in: captureIds } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      })
    : [];
  return {
    verificationRunId: row.id,
    schemaVersion: row.inputSchemaVersion,
    sha256: row.inputSha256,
    profile: row.inputProfile,
    profileVersion: row.inputProfileVersion,
    capturedAt: row.inputCapturedAt.toISOString(),
    input: JSON.parse(row.inputJson),
    sourceArtifacts: captures.map((capture) => ({
      id: capture.id,
      mediaType: capture.mediaType,
      sha256: capture.contentSha256,
      byteLength: capture.byteLength,
      available: capture.contentBytes !== null,
      href: `/api/verification-runs/${row.id}/source-artifacts/${capture.id}`,
    })),
  };
}

export async function getVerificationSourceArtifact(
  runId: string,
  captureId: string,
  auth: VerifierAuth,
  request: Request,
) {
  const run = await requireVerificationLease(request, runId, auth);
  if (!frozenEvidenceIndex(run).get("capture")?.has(captureId))
    throw new VerificationError(
      "forbidden",
      "Source artifact is not explicitly identified by this run's frozen input.",
    );
  const capture = await prisma.publicationCapture.findUnique({ where: { id: captureId } });
  if (!capture || capture.contentBytes === null)
    throw new VerificationError("not-found", "Stored source artifact bytes are unavailable.");
  const bytes = Buffer.from(capture.contentBytes, "utf8");
  if (bytes.byteLength !== capture.byteLength || digest(bytes) !== capture.contentSha256)
    throw new VerificationError("conflict", "Stored source artifact failed its integrity check.");
  return { capture, bytes };
}

export async function transitionVerificationRun(
  id: string,
  input: { status: "running" | "completed" | "failed" | "cancelled"; reason?: string },
  actor: { verifier?: VerifierAuth; userId?: string; request?: Request },
) {
  const current = await prisma.verificationRun.findUnique({ where: { id } });
  if (!current) throw new VerificationError("not-found", "Verification run not found.");
  if (current.status === input.status && (current.terminalReason ?? undefined) === input.reason)
    return runPublic(current, true);
  if (["completed", "failed", "cancelled"].includes(current.status))
    throw new VerificationError(
      "conflict",
      "Verification run already reached a different terminal state.",
    );
  if (input.status === "cancelled") {
    if (!actor.userId) throw new VerificationError("forbidden", "Only an editor may cancel a run.");
  } else {
    if (!actor.verifier || !actor.request)
      throw new VerificationError("forbidden", "A verifier lease is required for this transition.");
    await requireVerificationLease(actor.request, id, actor.verifier);
    if (input.status === "completed") {
      const count = await prisma.verificationFinding.count({ where: { verificationRunId: id } });
      if (count === 0)
        throw new VerificationError(
          "conflict",
          "A completed run must contain at least one finding.",
        );
    }
  }
  const from =
    input.status === "running"
      ? ["claimed"]
      : input.status === "cancelled"
        ? ["requested", "claimed", "running"]
        : ["claimed", "running"];
  const now = new Date();
  const updated = await concurrencyConflict(
    prisma.$transaction(async (tx) => {
      const changed = await tx.verificationRun.updateMany({
        where: { id, status: { in: from } },
        data: {
          status: input.status,
          startedAt: input.status === "running" ? now : current.startedAt,
          completedAt: ["completed", "failed", "cancelled"].includes(input.status) ? now : null,
          terminalReason: input.reason ?? null,
        },
      });
      if (changed.count !== 1) return null;
      const row = await tx.verificationRun.findUniqueOrThrow({ where: { id } });
      await tx.verificationRunLifecycleEvent.create({
        data: {
          verificationRunId: id,
          kind: input.status,
          actorUserId: actor.userId,
          actorVerifierId: actor.verifier?.verifierId,
          detailsJson: canonicalJson({ reason: input.reason ?? null }),
        },
      });
      return row;
    }),
    "Verification run changed concurrently.",
  );
  if (!updated) throw new VerificationError("conflict", "Verification run changed concurrently.");
  return runPublic(updated);
}

function artifactPublic(row: VerificationArtifact) {
  return {
    id: row.id,
    verificationRunId: row.verificationRunId,
    artifactKey: row.artifactKey,
    kind: row.kind,
    mediaType: row.mediaType,
    sha256: row.sha256,
    byteLength: row.byteLength,
    visibility: row.visibility,
    status: row.status,
    provenance: JSON.parse(row.provenanceJson),
    createdAt: row.createdAt.toISOString(),
    contentHref:
      row.status === "completed" ? `/api/verification-artifacts/${row.id}/content` : null,
  };
}

function sameArtifact(
  row: VerificationArtifact,
  input: {
    artifactKey: string;
    kind: string;
    mediaType: string;
    sha256: string;
    byteLength: number;
    visibility: string;
  },
) {
  return (
    row.artifactKey === input.artifactKey &&
    row.kind === input.kind &&
    row.mediaType === input.mediaType &&
    row.sha256 === input.sha256 &&
    row.byteLength === input.byteLength &&
    row.visibility === input.visibility
  );
}

export async function prepareVerificationArtifact(
  runId: string,
  input: {
    artifactKey: string;
    kind: string;
    mediaType: string;
    sha256: string;
    byteLength: number;
    visibility: string;
  },
  auth: VerifierAuth,
  request: Request,
) {
  const run = await requireVerificationLease(request, runId, auth);
  const existing = await prisma.verificationArtifact.findUnique({
    where: {
      verificationRunId_artifactKey: { verificationRunId: runId, artifactKey: input.artifactKey },
    },
  });
  if (existing) {
    if (!sameArtifact(existing, input))
      throw new VerificationError(
        "conflict",
        "Artifact key is bound to different immutable metadata.",
      );
    return uploadNegotiation(existing, true);
  }
  const now = new Date();
  const uploadExpiresAt = new Date(
    Math.min(run.leaseExpiresAt!.getTime(), now.getTime() + 15 * 60_000),
  );
  try {
    const row = await prisma.verificationArtifact.create({
      data: {
        verificationRunId: runId,
        submittedByVerifierId: auth.verifierId,
        artifactKey: input.artifactKey,
        kind: input.kind,
        mediaType: input.mediaType,
        sha256: input.sha256,
        byteLength: input.byteLength,
        visibility: input.visibility,
        provenanceJson: canonicalJson({
          credentialId: auth.credentialId,
          leaseGeneration: run.leaseGeneration,
        }),
        preparedAt: now,
        uploadExpiresAt,
      },
    });
    return uploadNegotiation(row, false);
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      const raced = await prisma.verificationArtifact.findUnique({
        where: {
          verificationRunId_artifactKey: {
            verificationRunId: runId,
            artifactKey: input.artifactKey,
          },
        },
      });
      if (raced && sameArtifact(raced, input)) return uploadNegotiation(raced, true);
      throw new VerificationError(
        "conflict",
        "Artifact key is bound to different immutable metadata.",
      );
    }
    throw error;
  }
}

function uploadNegotiation(row: VerificationArtifact, replayed: boolean) {
  return {
    artifactId: row.id,
    status: row.status,
    upload: {
      type: "oratlas-direct-binary-v1",
      method: "PUT",
      href: `/api/verification-artifacts/${row.id}/content`,
      headers: {
        "content-type": row.mediaType,
        "x-oratlas-verification-lease": "use current run lease",
      },
    },
    expiresAt: row.uploadExpiresAt.toISOString(),
    replayed,
  };
}

export async function uploadVerificationArtifact(
  artifactId: string,
  bytes: Uint8Array,
  mediaType: string,
  auth: VerifierAuth,
  request: Request,
) {
  const artifact = await prisma.verificationArtifact.findUnique({
    where: { id: artifactId },
    include: { blob: true },
  });
  if (!artifact) throw new VerificationError("not-found", "Verification artifact not found.");
  await requireVerificationLease(request, artifact.verificationRunId, auth);
  if (artifact.submittedByVerifierId !== auth.verifierId)
    throw new VerificationError("forbidden", "Artifact belongs to another verifier.");
  if (bytes.byteLength > VERIFICATION_ARTIFACT_MAX_BYTES)
    throw new VerificationError("payload-too-large", "Verification artifact exceeds 8 MiB.");
  if (
    mediaType.toLowerCase() !== artifact.mediaType.toLowerCase() ||
    bytes.byteLength !== artifact.byteLength ||
    digest(bytes) !== artifact.sha256
  )
    throw new VerificationError(
      "conflict",
      "Uploaded bytes do not match prepared media type, length, and SHA-256.",
    );
  if (artifact.blob) {
    if (digest(artifact.blob.bytes) !== artifact.sha256)
      throw new VerificationError("conflict", "Stored artifact integrity check failed.");
    return { ...artifactPublic(artifact), replayed: true };
  }
  if (artifact.status !== "prepared" || artifact.uploadExpiresAt <= new Date())
    throw new VerificationError("conflict", "Artifact upload is not prepared or has expired.");
  const row = await prisma.$transaction(async (tx) => {
    await tx.verificationArtifactBlob.create({ data: { artifactId, bytes: Buffer.from(bytes) } });
    return tx.verificationArtifact.update({
      where: { id: artifactId },
      data: {
        status: "uploaded",
        uploadedAt: new Date(),
        storageRef: `verification-blob:${artifactId}`,
      },
    });
  });
  return artifactPublic(row);
}

export async function completeVerificationArtifact(
  runId: string,
  artifactId: string,
  auth: VerifierAuth,
  request: Request,
) {
  await requireVerificationLease(request, runId, auth);
  const artifact = await prisma.verificationArtifact.findUnique({
    where: { id: artifactId },
    include: { blob: true },
  });
  if (!artifact || artifact.verificationRunId !== runId)
    throw new VerificationError("not-found", "Artifact is not part of this run.");
  if (artifact.submittedByVerifierId !== auth.verifierId)
    throw new VerificationError("forbidden", "Artifact belongs to another verifier.");
  if (artifact.status === "completed") return { ...artifactPublic(artifact), replayed: true };
  if (
    artifact.status !== "uploaded" ||
    !artifact.blob ||
    artifact.blob.bytes.byteLength !== artifact.byteLength ||
    digest(artifact.blob.bytes) !== artifact.sha256
  )
    throw new VerificationError(
      "conflict",
      "Uploaded artifact has not passed its length and SHA-256 checks.",
    );
  const completedAt = new Date();
  const changed = await concurrencyConflict(
    prisma.verificationArtifact.updateMany({
      where: { id: artifact.id, status: "uploaded" },
      data: { status: "completed", completedAt },
    }),
    "Artifact completion raced with another state change.",
  );
  if (changed.count === 1) {
    const row = await prisma.verificationArtifact.findUniqueOrThrow({ where: { id: artifact.id } });
    return artifactPublic(row);
  }
  const raced = await prisma.verificationArtifact.findUnique({ where: { id: artifact.id } });
  if (raced?.status === "completed") return { ...artifactPublic(raced), replayed: true };
  throw new VerificationError("conflict", "Artifact completion raced with another state change.");
}

export async function getVerificationArtifactContent(
  artifactId: string,
  request?: Request,
  auth?: VerifierAuth,
) {
  const artifact = await prisma.verificationArtifact.findUnique({
    where: { id: artifactId },
    include: { blob: true },
  });
  if (!artifact || !artifact.blob || artifact.status !== "completed")
    throw new VerificationError("not-found", "Completed verification artifact not found.");
  if (artifact.visibility !== "public") {
    if (!request || !auth)
      throw new VerificationError(
        "unauthorized",
        "Private artifact access requires verifier authentication.",
      );
    await requireVerificationLease(request, artifact.verificationRunId, auth);
  }
  if (
    artifact.blob.bytes.byteLength !== artifact.byteLength ||
    digest(artifact.blob.bytes) !== artifact.sha256
  )
    throw new VerificationError("conflict", "Stored artifact failed its integrity check.");
  return { artifact, bytes: artifact.blob.bytes };
}

function ids(items: unknown): Set<string> {
  if (!Array.isArray(items)) return new Set();
  return new Set(
    items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const id = (item as Record<string, unknown>).id;
      return typeof id === "string" ? [id] : [];
    }),
  );
}

function frozenEvidenceIndex(run: VerificationRun) {
  const root = JSON.parse(run.inputJson) as Record<string, unknown>;
  const context =
    root.publicationContext && typeof root.publicationContext === "object"
      ? (root.publicationContext as Record<string, unknown>)
      : root;
  const occurrences = Array.isArray(context.occurrences)
    ? context.occurrences
    : context.occurrence
      ? [context.occurrence]
      : [];
  const nodeVersionIds = new Set<string>();
  for (const occurrence of occurrences) {
    if (!occurrence || typeof occurrence !== "object") continue;
    const binding = (occurrence as Record<string, unknown>).canonicalBinding;
    if (binding && typeof binding === "object") {
      const id = (binding as Record<string, unknown>).knowledgeNodeVersionId;
      if (typeof id === "string") nodeVersionIds.add(id);
    }
  }
  const subject = root.subject;
  if (subject && typeof subject === "object") {
    const subjectRecord = subject as Record<string, unknown>;
    if (subjectRecord.type === "knowledge-node-version" && typeof subjectRecord.id === "string")
      nodeVersionIds.add(subjectRecord.id);
  }
  const executionPassportIds = new Set(run.executionPassportId ? [run.executionPassportId] : []);
  if (Array.isArray(context.productionProvenance)) {
    for (const assertion of context.productionProvenance) {
      if (!assertion || typeof assertion !== "object") continue;
      const passportId = (assertion as Record<string, unknown>).executionPassportId;
      if (typeof passportId === "string") executionPassportIds.add(passportId);
    }
  }
  return new Map<string, Set<string>>([
    ["publication-content-document", ids(context.content)],
    ["publication-occurrence", ids(occurrences)],
    ["canonical-node-version", nodeVersionIds],
    ["canonical-relation", ids(context.relations)],
    ["capture", ids(context.captures)],
    ["production-provenance", ids(context.productionProvenance)],
    ["execution-passport", executionPassportIds],
  ]);
}

async function validateFindingReferences(
  run: VerificationRun,
  evidenceRefs: VerificationEvidenceReference[],
  artifactRefs: string[],
) {
  const frozen = frozenEvidenceIndex(run);
  const artifactIds = new Set(artifactRefs);
  for (const reference of evidenceRefs) {
    if (reference.type === "verification-artifact") artifactIds.add(reference.id);
    else if (!frozen.get(reference.type)?.has(reference.id))
      throw new VerificationError(
        "bad-request",
        `Evidence reference ${reference.type}:${reference.id} is absent from the frozen input.`,
      );
  }
  if (!artifactIds.size) return [];
  const artifacts = await prisma.verificationArtifact.findMany({
    where: { id: { in: [...artifactIds] } },
  });
  if (
    artifacts.length !== artifactIds.size ||
    artifacts.some((item) => item.verificationRunId !== run.id || item.status !== "completed")
  )
    throw new VerificationError(
      "bad-request",
      "Findings may cite only completed artifacts from the same run.",
    );
  return [...artifactIds].sort();
}

function findingPublic(row: {
  id: string;
  verificationRunId: string;
  submittedByVerifierId: string;
  findingKey: string;
  findingType: string;
  status: string;
  impact: string;
  statement: string;
  rationale: string;
  reportedJson: string | null;
  observedJson: string | null;
  toleranceJson: string | null;
  evidenceRefsJson: string;
  payloadJson: string;
  payloadSha256: string;
  supersedesFindingId: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    verificationRunId: row.verificationRunId,
    submittedByVerifierId: row.submittedByVerifierId,
    findingKey: row.findingKey,
    findingType: row.findingType,
    status: row.status,
    impact: row.impact,
    statement: row.statement,
    rationale: row.rationale,
    reported: row.reportedJson ? JSON.parse(row.reportedJson) : null,
    observed: row.observedJson ? JSON.parse(row.observedJson) : null,
    tolerance: row.toleranceJson ? JSON.parse(row.toleranceJson) : null,
    evidenceRefs: JSON.parse(row.evidenceRefsJson),
    artifactRefs: (JSON.parse(row.payloadJson) as { artifactRefs?: string[] }).artifactRefs ?? [],
    payloadSha256: row.payloadSha256,
    supersedesFindingId: row.supersedesFindingId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function submitVerificationFinding(
  runId: string,
  raw: SubmitVerificationFinding,
  auth: VerifierAuth,
  request: Request,
) {
  const input = submitVerificationFindingSchema.parse(raw);
  const run = await requireVerificationLease(request, runId, auth);
  const artifactRefs = await validateFindingReferences(run, input.evidenceRefs, input.artifactRefs);
  if (input.supersedesFindingId) {
    const prior = await prisma.verificationFinding.findUnique({
      where: { id: input.supersedesFindingId },
    });
    if (!prior || prior.verificationRunId !== runId)
      throw new VerificationError(
        "bad-request",
        "A finding may supersede only a finding from the same run.",
      );
  }
  const payload = { ...input, artifactRefs };
  const payloadJson = canonicalJson(payload);
  const existing = await prisma.verificationFinding.findUnique({
    where: {
      verificationRunId_findingKey: { verificationRunId: runId, findingKey: input.findingKey },
    },
  });
  if (existing) {
    if (existing.payloadJson !== payloadJson)
      throw new VerificationError(
        "conflict",
        "Finding key is bound to a different immutable payload.",
      );
    return { ...findingPublic(existing), replayed: true };
  }
  try {
    const row = await prisma.$transaction(async (tx) => {
      const created = await tx.verificationFinding.create({
        data: {
          verificationRunId: runId,
          submittedByVerifierId: auth.verifierId,
          findingKey: input.findingKey,
          findingType: input.findingType,
          status: input.status,
          impact: input.impact,
          statement: input.statement,
          rationale: input.rationale,
          reportedJson: input.reported === undefined ? null : canonicalJson(input.reported),
          observedJson: input.observed === undefined ? null : canonicalJson(input.observed),
          toleranceJson: input.tolerance === undefined ? null : canonicalJson(input.tolerance),
          evidenceRefsJson: canonicalJson(input.evidenceRefs),
          payloadJson,
          payloadSha256: digest(payloadJson),
          supersedesFindingId: input.supersedesFindingId,
        },
      });
      if (artifactRefs.length)
        await tx.verificationFindingArtifact.createMany({
          data: artifactRefs.map((verificationArtifactId) => ({
            verificationFindingId: created.id,
            verificationArtifactId,
          })),
        });
      return created;
    });
    return findingPublic(row);
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      const raced = await prisma.verificationFinding.findUnique({
        where: {
          verificationRunId_findingKey: { verificationRunId: runId, findingKey: input.findingKey },
        },
      });
      if (raced?.payloadJson === payloadJson) return { ...findingPublic(raced), replayed: true };
      throw new VerificationError(
        "conflict",
        "Finding key is bound to a different immutable payload.",
      );
    }
    throw error;
  }
}

export async function listVerificationFindings(runId: string) {
  const run = await prisma.verificationRun.findUnique({ where: { id: runId } });
  if (!run) throw new VerificationError("not-found", "Verification run not found.");
  const rows = await prisma.verificationFinding.findMany({
    where: { verificationRunId: runId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return {
    schemaVersion: VERIFICATION_API_SCHEMA_VERSION,
    verificationRunId: runId,
    findings: rows.map(findingPublic),
  };
}

export async function listPublicationVersionVerifications(publicationVersionId: string) {
  const version = await prisma.publicationVersion.findUnique({
    where: { id: publicationVersionId },
    select: { id: true },
  });
  if (!version) throw new VerificationError("not-found", "Publication version not found.");
  const runs = await prisma.verificationRun.findMany({
    where: {
      OR: [
        { publicationVersionId },
        { publicationClaimOccurrence: { publicationVersionId } },
        {
          knowledgeNodeVersion: {
            sourcePublicationClaimOccurrence: { publicationVersionId },
          },
        },
      ],
    },
    include: {
      protocol: true,
      claimedVerifier: { select: { id: true, slug: true, name: true } },
      findings: true,
    },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
  });
  const summary: Record<string, Record<string, number>> = {};
  for (const run of runs)
    for (const finding of run.findings) {
      const category = finding.findingType.startsWith("figure")
        ? "figures"
        : finding.findingType.startsWith("analysis")
          ? "analyses"
          : "statistics";
      const observed = finding.observedJson
        ? (JSON.parse(finding.observedJson) as Record<string, unknown>)
        : null;
      const summaryStatus =
        category === "analyses" &&
        finding.status === "verified" &&
        observed?.method === "independent-reproduction"
          ? "independently-reproduced"
          : finding.status;
      summary[category] ??= {};
      summary[category]![summaryStatus] = (summary[category]![summaryStatus] ?? 0) + 1;
    }
  return {
    schemaVersion: VERIFICATION_API_SCHEMA_VERSION,
    publicationVersionId,
    summary,
    runs: runs.map((run) => ({
      ...runPublic(run),
      protocol: { seriesKey: run.protocol.seriesKey, version: run.protocol.protocolVersion },
      verifier: run.claimedVerifier,
      findings: run.findings.map(findingPublic),
    })),
  };
}
