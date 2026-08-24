import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  canonicalJson,
  certificationProtocolDefinitionSchema,
  certificationRunTerminalTransitionSchema,
  publicCertificationSummarySchema,
  submitCertificationResultSchema,
  type CertificationEvidenceReference,
  type CertificationProtocolDefinition,
  type PublicationVersionPacket,
  type SubmitCertificationResult,
} from "@oratlas/contracts";
import {
  Prisma,
  type CertificationLifecycleEvent,
  type CertificationResult,
  type CertificationRun,
} from "@oratlas/db";
import { prisma } from "./db";
import { getPublicationVersionPacket } from "./publication-version-packet";

export type CertificationErrorCode =
  "unauthorized" | "forbidden" | "not-found" | "conflict" | "bad-request";
export class CertificationError extends Error {
  constructor(
    public readonly code: CertificationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CertificationError";
  }
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const certifierPublic = (row: {
  id: string;
  slug: string;
  name: string;
  description: string;
  publicUrl: string | null;
  governanceUrl: string | null;
  publicContact: string | null;
  status: string;
  createdAt: Date;
  activatedAt: Date | null;
  retiredAt: Date | null;
}) => ({
  id: row.id,
  slug: row.slug,
  name: row.name,
  description: row.description,
  publicUrl: row.publicUrl,
  governanceUrl: row.governanceUrl,
  publicContact: row.publicContact,
  status: row.status,
  createdAt: row.createdAt.toISOString(),
  activatedAt: row.activatedAt?.toISOString() ?? null,
  retiredAt: row.retiredAt?.toISOString() ?? null,
  href: `/api/certifiers/${row.id}`,
});

export async function listCertifiers() {
  const rows = await prisma.certifier.findMany({ orderBy: [{ name: "asc" }, { id: "asc" }] });
  return { schemaVersion: "1.0.0", certifiers: rows.map(certifierPublic) };
}
export async function getCertifier(id: string) {
  const row = await prisma.certifier.findFirst({ where: { OR: [{ id }, { slug: id }] } });
  if (!row) throw new CertificationError("not-found", "Certifier not found.");
  return certifierPublic(row);
}
export async function createCertifier(
  input: {
    slug: string;
    name: string;
    description: string;
    publicUrl?: string;
    governanceUrl?: string;
    publicContact?: string;
  },
  actorId: string,
) {
  const now = new Date();
  try {
    const row = await prisma.certifier.create({
      data: { ...input, status: "active", activatedAt: now, createdById: actorId },
    });
    await prisma.auditEvent.create({
      data: {
        actorId,
        action: "certification.certifier-created",
        subjectType: "certifier",
        subjectId: row.id,
        detailsJson: canonicalJson({ slug: row.slug }),
      },
    });
    return certifierPublic(row);
  } catch (error) {
    if (prismaCode(error) === "P2002")
      throw new CertificationError("conflict", "Certifier slug already exists.");
    throw error;
  }
}
export async function setCertifierStatus(
  id: string,
  status: "active" | "suspended" | "retired",
  actorId: string,
) {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const now = new Date();
        const existing = await tx.certifier.findUnique({ where: { id } });
        if (!existing) throw new CertificationError("not-found", "Certifier not found.");
        if (existing.status === status) return certifierPublic(existing);
        if (existing.status === "retired")
          throw new CertificationError("conflict", "A retired certifier cannot be reactivated.");
        const changed = await tx.certifier.updateMany({
          where: { id, status: existing.status },
          data: {
            status,
            activatedAt: status === "active" ? (existing.activatedAt ?? now) : existing.activatedAt,
            retiredAt: status === "retired" ? (existing.retiredAt ?? now) : existing.retiredAt,
          },
        });
        if (changed.count !== 1)
          throw new CertificationError(
            "conflict",
            "Certifier status changed concurrently; retry against the current state.",
          );
        const row = await tx.certifier.findUniqueOrThrow({ where: { id } });
        await tx.auditEvent.create({
          data: {
            actorId,
            action: "certification.certifier-status",
            subjectType: "certifier",
            subjectId: id,
            detailsJson: canonicalJson({ previous: existing.status, status }),
          },
        });
        return certifierPublic(row);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    if (prismaCode(error) !== "P2034") throw error;
    const current = await prisma.certifier.findUnique({ where: { id } });
    if (current?.status === status) return certifierPublic(current);
    if (current?.status === "retired")
      throw new CertificationError("conflict", "A retired certifier cannot be reactivated.");
    throw new CertificationError(
      "conflict",
      "Certifier status changed concurrently; retry against the current state.",
    );
  }
}

function protocolPublic(row: {
  id: string;
  certifierId: string;
  seriesKey: string;
  protocolVersion: string;
  title: string;
  description: string;
  protocolJson: string;
  protocolSha256: string;
  status: string;
  supersedesProtocolId: string | null;
  createdAt: Date;
  certifier?: { id: string; slug: string; name: string };
}) {
  return {
    id: row.id,
    certifier: row.certifier,
    certifierId: row.certifierId,
    seriesKey: row.seriesKey,
    version: row.protocolVersion,
    title: row.title,
    description: row.description,
    definition: certificationProtocolDefinitionSchema.parse(JSON.parse(row.protocolJson)),
    sha256: row.protocolSha256,
    status: row.status,
    supersedesProtocolId: row.supersedesProtocolId,
    createdAt: row.createdAt.toISOString(),
    href: `/api/certification-protocols/${row.id}`,
  };
}
export async function listCertificationProtocols(certifierId?: string) {
  const rows = await prisma.certificationProtocol.findMany({
    where: certifierId ? { certifierId } : undefined,
    include: { certifier: { select: { id: true, slug: true, name: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return { schemaVersion: "1.0.0", protocols: rows.map(protocolPublic) };
}
export async function getCertificationProtocol(id: string) {
  const row = await prisma.certificationProtocol.findUnique({
    where: { id },
    include: { certifier: { select: { id: true, slug: true, name: true } } },
  });
  if (!row) throw new CertificationError("not-found", "Certification protocol not found.");
  return protocolPublic(row);
}
export async function createCertificationProtocol(
  input: {
    certifierId: string;
    seriesKey: string;
    version: string;
    title: string;
    description: string;
    definition: CertificationProtocolDefinition;
    supersedesProtocolId?: string;
  },
  actorId: string,
) {
  const definition = certificationProtocolDefinitionSchema.parse(input.definition);
  const protocolJson = canonicalJson(definition);
  const owner = await prisma.certifier.findUnique({ where: { id: input.certifierId } });
  if (!owner) throw new CertificationError("not-found", "Certifier not found.");
  if (owner.status !== "active")
    throw new CertificationError(
      "conflict",
      "Only an active certifier may publish a protocol version.",
    );
  if (input.supersedesProtocolId) {
    const prior = await prisma.certificationProtocol.findUnique({
      where: { id: input.supersedesProtocolId },
    });
    if (!prior || prior.certifierId !== input.certifierId || prior.seriesKey !== input.seriesKey)
      throw new CertificationError(
        "conflict",
        "A protocol may supersede only the same certifier's protocol series.",
      );
  }
  try {
    const row = await prisma.certificationProtocol.create({
      data: {
        certifierId: input.certifierId,
        seriesKey: input.seriesKey,
        protocolVersion: input.version,
        title: input.title,
        description: input.description,
        protocolJson,
        protocolSha256: digest(protocolJson),
        supersedesProtocolId: input.supersedesProtocolId,
      },
    });
    await prisma.auditEvent.create({
      data: {
        actorId,
        action: "certification.protocol-created",
        subjectType: "certification-protocol",
        subjectId: row.id,
        detailsJson: canonicalJson({
          certifierId: row.certifierId,
          seriesKey: row.seriesKey,
          version: row.protocolVersion,
          sha256: row.protocolSha256,
        }),
      },
    });
    return protocolPublic(row);
  } catch (error) {
    if (prismaCode(error) === "P2002")
      throw new CertificationError(
        "conflict",
        "That exact protocol version or supersession already exists.",
      );
    throw error;
  }
}
export async function retireCertificationProtocol(id: string, actorId: string) {
  const existing = await prisma.certificationProtocol.findUnique({ where: { id } });
  if (!existing) throw new CertificationError("not-found", "Certification protocol not found.");
  if (existing.status === "retired") return protocolPublic(existing);
  const row = await prisma.certificationProtocol.update({
    where: { id },
    data: { status: "retired" },
  });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "certification.protocol-retired",
      subjectType: "certification-protocol",
      subjectId: id,
      detailsJson: canonicalJson({ protocolSha256: row.protocolSha256 }),
    },
  });
  return protocolPublic(row);
}

export async function issueCertifierCredential(
  certifierId: string,
  input: { label: string; scopes: string[]; expiresAt?: string },
  actorId: string,
) {
  const certifier = await prisma.certifier.findUnique({ where: { id: certifierId } });
  if (!certifier) throw new CertificationError("not-found", "Certifier not found.");
  const prefix = randomBytes(9).toString("base64url");
  const token = `oratlas_cert_${prefix}.${randomBytes(32).toString("base64url")}`;
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.certifierCredential.create({
      data: {
        certifierId,
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
        action: "certification.credential-issued",
        subjectType: "certifier-credential",
        subjectId: created.id,
        detailsJson: canonicalJson({
          certifierId,
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
    certifierId,
    label: row.label,
    scopes: JSON.parse(row.scopesJson),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    token,
  };
}
export async function revokeCertifierCredential(id: string, actorId: string) {
  const row = await prisma.certifierCredential.findUnique({ where: { id } });
  if (!row) throw new CertificationError("not-found", "Credential not found.");
  if (!row.revokedAt)
    await prisma.certifierCredential.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById: actorId },
    });
  await prisma.auditEvent.create({
    data: {
      actorId,
      action: "certification.credential-revoked",
      subjectType: "certifier-credential",
      subjectId: id,
      detailsJson: canonicalJson({ certifierId: row.certifierId }),
    },
  });
}

export async function authenticateCertifier(
  request: Request,
  scope: "certification:read" | "certification:submit",
) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const match = /^oratlas_cert_([A-Za-z0-9_-]{12})\.[A-Za-z0-9_-]+$/.exec(token);
  if (!match)
    throw new CertificationError(
      "unauthorized",
      "A valid certifier bearer credential is required.",
    );
  const row = await prisma.certifierCredential.findUnique({
    where: { tokenPrefix: match[1] },
    include: { certifier: true },
  });
  const supplied = Buffer.from(digest(token), "hex");
  const stored = row ? Buffer.from(row.tokenHash, "hex") : Buffer.alloc(32);
  if (!row || supplied.length !== stored.length || !timingSafeEqual(supplied, stored))
    throw new CertificationError(
      "unauthorized",
      "A valid certifier bearer credential is required.",
    );
  if (row.revokedAt || (row.expiresAt && row.expiresAt <= new Date()))
    throw new CertificationError("unauthorized", "The certifier credential is revoked or expired.");
  if (row.certifier.status !== "active")
    throw new CertificationError("forbidden", "The certifier is not active.");
  const scopes = JSON.parse(row.scopesJson) as string[];
  if (!scopes.includes(scope))
    throw new CertificationError("forbidden", `Credential lacks ${scope} scope.`);
  await prisma.certifierCredential.update({
    where: { id: row.id },
    data: { lastUsedAt: new Date() },
  });
  return { credentialId: row.id, certifierId: row.certifierId };
}

export async function createCertificationRun(
  input: {
    publicationVersionId: string;
    certificationProtocolId: string;
    assessmentMode: string;
    externalRunReference?: string;
    idempotencyKey: string;
  },
  auth: { certifierId: string },
) {
  const existing = await prisma.certificationRun.findUnique({
    where: {
      certifierId_idempotencyKey: {
        certifierId: auth.certifierId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (existing) return assertRunReplay(existing, input);
  const protocol = await prisma.certificationProtocol.findUnique({
    where: { id: input.certificationProtocolId },
  });
  if (!protocol || protocol.certifierId !== auth.certifierId)
    throw new CertificationError(
      "conflict",
      "Protocol does not belong to the authenticated certifier.",
    );
  if (protocol.status !== "active")
    throw new CertificationError("conflict", "Certification protocol is not active.");
  const definition = certificationProtocolDefinitionSchema.parse(JSON.parse(protocol.protocolJson));
  if (!definition.assessmentModes.includes(input.assessmentMode as never))
    throw new CertificationError(
      "bad-request",
      "Assessment mode is not permitted by this protocol.",
    );
  const packet = await getPublicationVersionPacket(input.publicationVersionId);
  const inputPacketJson = canonicalJson(packet);
  const snapshotHash = digest(inputPacketJson);
  for (const section of definition.requireCompleteSections) {
    const incomplete =
      section === "content"
        ? packet.completeness.content.truncated ||
          packet.completeness.content.coverage !== "complete"
        : packet.completeness[section].truncated;
    if (incomplete)
      throw new CertificationError(
        "conflict",
        `Protocol requires a complete ${section} packet section.`,
      );
  }
  try {
    const row = await prisma.certificationRun.create({
      data: {
        publicationVersionId: input.publicationVersionId,
        certifierId: auth.certifierId,
        protocolId: protocol.id,
        assessmentMode: input.assessmentMode,
        status: "running",
        externalRunReference: input.externalRunReference,
        idempotencyKey: input.idempotencyKey,
        inputPacketJson,
        inputPacketSha256: snapshotHash,
        packetSchemaVersion: packet.schemaVersion,
        completenessJson: canonicalJson(packet.completeness),
        capturedAt: new Date(),
        startedAt: new Date(),
      },
    });
    return mapRun(row, false);
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      const raced = await prisma.certificationRun.findUnique({
        where: {
          certifierId_idempotencyKey: {
            certifierId: auth.certifierId,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (raced) return assertRunReplay(raced, input);
    }
    throw error;
  }
}

function assertRunReplay(
  row: CertificationRun,
  input: {
    publicationVersionId: string;
    certificationProtocolId: string;
    assessmentMode: string;
    externalRunReference?: string;
  },
) {
  if (
    row.publicationVersionId !== input.publicationVersionId ||
    row.protocolId !== input.certificationProtocolId ||
    row.assessmentMode !== input.assessmentMode ||
    (row.externalRunReference ?? undefined) !== input.externalRunReference
  )
    throw new CertificationError(
      "conflict",
      "Idempotency key is already bound to a different certification run.",
    );
  return mapRun(row, true);
}
function mapRun(row: CertificationRun, replayed = false) {
  return {
    id: row.id,
    publicationVersionId: row.publicationVersionId,
    certifierId: row.certifierId,
    certificationProtocolId: row.protocolId,
    assessmentMode: row.assessmentMode,
    status: row.status,
    terminalReason: row.terminalReason,
    externalRunReference: row.externalRunReference,
    input: {
      packetSchemaVersion: row.packetSchemaVersion,
      packetSha256: row.inputPacketSha256,
      capturedAt: row.capturedAt.toISOString(),
      completeness: JSON.parse(row.completenessJson),
    },
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    replayed,
    links: {
      self: `/api/certification-runs/${row.id}`,
      input: `/api/certification-runs/${row.id}/input`,
      result: `/api/certification-runs/${row.id}/result`,
      transition: `/api/certification-runs/${row.id}/transition`,
    },
  };
}
export async function getCertificationRun(id: string, certifierId: string) {
  const row = await prisma.certificationRun.findUnique({ where: { id } });
  if (!row) throw new CertificationError("not-found", "Certification run not found.");
  if (row.certifierId !== certifierId)
    throw new CertificationError("forbidden", "Certification run belongs to another certifier.");
  return mapRun(row);
}
export async function getCertificationInput(id: string, certifierId: string) {
  const row = await prisma.certificationRun.findUnique({ where: { id } });
  if (!row) throw new CertificationError("not-found", "Certification run not found.");
  if (row.certifierId !== certifierId)
    throw new CertificationError("forbidden", "Certification run belongs to another certifier.");
  if (digest(row.inputPacketJson) !== row.inputPacketSha256)
    throw new CertificationError(
      "conflict",
      "Captured certification input failed its integrity check.",
    );
  return {
    certificationRunId: row.id,
    packetSchemaVersion: row.packetSchemaVersion,
    packetSha256: row.inputPacketSha256,
    capturedAt: row.capturedAt.toISOString(),
    completeness: JSON.parse(row.completenessJson),
    packet: JSON.parse(row.inputPacketJson),
  };
}

export async function transitionCertificationRun(
  id: string,
  raw: unknown,
  auth: { certifierId: string; credentialId?: string },
) {
  const input = certificationRunTerminalTransitionSchema.parse(raw);
  const transition = async () => {
    const current = await prisma.certificationRun.findUnique({ where: { id } });
    if (!current) throw new CertificationError("not-found", "Certification run not found.");
    if (current.certifierId !== auth.certifierId)
      throw new CertificationError("forbidden", "Certification run belongs to another certifier.");
    if (current.status === input.status && current.terminalReason === input.reason)
      return { ...mapRun(current, true), replayed: true };
    if (["completed", "failed", "cancelled"].includes(current.status))
      throw new CertificationError("conflict", "Certification run already has a different terminal state.");

    const completedAt = new Date();
    const updated = await prisma.$transaction(
      async (tx) => {
        const claimed = await tx.certificationRun.updateMany({
          where: { id, certifierId: auth.certifierId, status: { in: ["requested", "running"] } },
          data: { status: input.status, terminalReason: input.reason, completedAt },
        });
        if (claimed.count !== 1) return null;
        const row = await tx.certificationRun.findUniqueOrThrow({ where: { id } });
        await tx.auditEvent.create({
          data: {
            action: `certification.run-${input.status}`,
            subjectType: "certification-run",
            subjectId: id,
            idempotencyKey: `certification-run:${id}:${input.status}`,
            detailsJson: canonicalJson({
              certifierId: auth.certifierId,
              credentialId: auth.credentialId,
              reason: input.reason,
            }),
          },
        });
        return row;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    if (updated) return mapRun(updated);
    const raced = await prisma.certificationRun.findUnique({ where: { id } });
    if (raced?.status === input.status && raced.terminalReason === input.reason)
      return { ...mapRun(raced, true), replayed: true };
    throw new CertificationError("conflict", "Certification run concurrently reached another state.");
  };
  try {
    return await transition();
  } catch (error) {
    if (prismaCode(error) === "P2034") return transition();
    throw error;
  }
}

export async function submitCertificationResult(
  runId: string,
  raw: SubmitCertificationResult,
  auth: { certifierId: string },
) {
  const input = submitCertificationResultSchema.parse(raw);
  const candidateJson = canonicalJson(input);
  const run = await prisma.certificationRun.findUnique({
    where: { id: runId },
    include: { protocol: true },
  });
  if (!run) throw new CertificationError("not-found", "Certification run not found.");
  if (run.certifierId !== auth.certifierId)
    throw new CertificationError("forbidden", "Certification run belongs to another certifier.");
  const existing = await prisma.certificationResult.findUnique({
    where: { certificationRunId: runId },
  });
  if (existing) return replayResult(existing, candidateJson);
  if (run.status !== "running")
    throw new CertificationError("conflict", "Certification run is not open for result submission.");
  if (
    run.inputPacketSha256 !== input.packetSha256 ||
    digest(run.inputPacketJson) !== run.inputPacketSha256
  )
    throw new CertificationError(
      "conflict",
      "Result packet hash does not match the immutable run input.",
    );
  const definition = certificationProtocolDefinitionSchema.parse(
    JSON.parse(run.protocol.protocolJson),
  );
  validateResult(input, definition, JSON.parse(run.inputPacketJson));
  await validateExecutionProvenance(
    input,
    run.assessmentMode,
    run.inputPacketSha256,
    JSON.parse(run.inputPacketJson).sha256,
  );
  if (input.supersedesCertificationResultId) {
    const prior = await prisma.certificationResult.findUnique({
      where: { id: input.supersedesCertificationResultId },
      include: { supersededBy: true },
    });
    if (
      !prior ||
      prior.publicationVersionId !== run.publicationVersionId ||
      prior.certifierId !== run.certifierId ||
      prior.protocolId !== run.protocolId ||
      prior.supersededBy
    )
      throw new CertificationError(
        "conflict",
        "Supersession must target an unsuperseded result for the same subject, certifier, and protocol.",
      );
  }
  const issuedAt = new Date();
  try {
    const created = await prisma.$transaction(
      async (tx) => {
        const row = await tx.certificationResult.create({
          data: {
            certificationRunId: run.id,
            publicationVersionId: run.publicationVersionId,
            certifierId: run.certifierId,
            protocolId: run.protocolId,
            inputPacketSha256: run.inputPacketSha256,
            assessmentMode: run.assessmentMode,
            criteriaJson: canonicalJson(input.criteria),
            outcome: input.outcome,
            limitationsJson: canonicalJson(input.limitations),
            conflictOfInterestJson: canonicalJson(input.conflictOfInterest),
            independenceJson: canonicalJson(input.independence),
            provenanceJson: canonicalJson(input.provenance),
            resultJson: candidateJson,
            resultSha256: digest(candidateJson),
            agentRunId: input.provenance.agentRunId,
            executionPassportId: input.provenance.executionPassportId,
            supersedesResultId: input.supersedesCertificationResultId,
            issuedAt,
          },
        });
        await tx.certificationLifecycleEvent.create({
          data: { resultId: row.id, kind: "issued", actorCertifierId: run.certifierId },
        });
        if (input.supersedesCertificationResultId)
          await tx.certificationLifecycleEvent.create({
            data: {
              resultId: input.supersedesCertificationResultId,
              kind: "superseded",
              reason: `Superseded by ${row.id}`,
              actorCertifierId: run.certifierId,
            },
          });
        await tx.certificationRun.update({
          where: { id: run.id },
          data: { status: "completed", completedAt: issuedAt },
        });
        return row;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return mapResult(created, [{ kind: "issued", reason: null, createdAt: issuedAt }], false);
  } catch (error) {
    if (prismaCode(error) === "P2002" || prismaCode(error) === "P2034") {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const raced = await prisma.certificationResult.findUnique({
          where: { certificationRunId: runId },
        });
        if (raced) return replayResult(raced, candidateJson);
        await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
      }
      throw new CertificationError(
        "conflict",
        "Concurrent result submission conflicted; retry the exact request.",
      );
    }
    throw error;
  }
}

function validateResult(
  input: SubmitCertificationResult,
  definition: CertificationProtocolDefinition,
  packet: PublicationVersionPacket,
) {
  if (!definition.outcomes.includes(input.outcome))
    throw new CertificationError("bad-request", "Outcome is not permitted by the protocol.");
  const submitted = new Map<string, (typeof input.criteria)[number]>();
  for (const result of input.criteria) {
    if (submitted.has(result.criterionId))
      throw new CertificationError("bad-request", `Duplicate criterion '${result.criterionId}'.`);
    const criterion = definition.criteria.find((candidate) => candidate.id === result.criterionId);
    if (!criterion)
      throw new CertificationError("bad-request", `Unknown criterion '${result.criterionId}'.`);
    if (!criterion.allowedStatuses.includes(result.status))
      throw new CertificationError(
        "bad-request",
        `Status is not allowed for criterion '${result.criterionId}'.`,
      );
    if (criterion.evidenceRequired && result.evidenceRefs.length === 0)
      throw new CertificationError(
        "bad-request",
        `Criterion '${result.criterionId}' requires evidence.`,
      );
    for (const reference of result.evidenceRefs) validateEvidence(reference, packet);
    submitted.set(result.criterionId, result);
  }
  const missing = definition.criteria.filter(
    (criterion) => criterion.required && !submitted.has(criterion.id),
  );
  if (missing.length)
    throw new CertificationError(
      "bad-request",
      `Missing mandatory criteria: ${missing.map((criterion) => criterion.id).join(", ")}.`,
    );
}
function validateEvidence(
  reference: CertificationEvidenceReference,
  packet: PublicationVersionPacket,
) {
  if (reference.type === "external-immutable-resource") return;
  // CertificationRun rows created before packet 1.2 remain valid immutable
  // inputs. They have no content member, so new content references must be
  // treated as absent instead of crashing a legacy result submission.
  const contentDocuments: Array<{ id: string }> = Array.isArray(
    (packet as { content?: unknown }).content,
  )
    ? packet.content
    : [];
  const values: Record<string, string[]> = {
    "publication-occurrence": packet.occurrences.map((value) => value.id),
    "publication-content-document": contentDocuments.map((value) => value.id),
    "canonical-node-version": packet.occurrences.flatMap((value) =>
      value.canonicalBinding ? [value.canonicalBinding.knowledgeNodeVersionId] : [],
    ),
    "canonical-relation": packet.relations.map((value) => value.id),
    "production-provenance": packet.productionProvenance.map((value) => value.id),
    capture: packet.captures.map((value) => value.id),
    "trust-assessment": collectIds(packet, new Set(["trustAssessmentId", "assessmentId"])),
  };
  if (!values[reference.type]?.includes(reference.id))
    throw new CertificationError(
      "bad-request",
      `Evidence reference '${reference.type}:${reference.id}' is not present in the captured packet.`,
    );
}
function collectIds(value: unknown, keys: Set<string>): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) for (const item of value) found.push(...collectIds(item, keys));
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if (keys.has(key) && typeof item === "string") found.push(item);
      found.push(...collectIds(item, keys));
    }
  return found;
}
async function validateExecutionProvenance(
  input: SubmitCertificationResult,
  mode: string,
  snapshotHash: string,
  packetHash: string,
) {
  const { agentRunId, executionPassportId } = input.provenance;
  if (mode !== "human" && !agentRunId && !executionPassportId)
    throw new CertificationError(
      "bad-request",
      "AI and hybrid certification require exact execution provenance.",
    );
  if (agentRunId) {
    const run = await prisma.agentRun.findUnique({ where: { id: agentRunId } });
    if (!run || run.status !== "succeeded" || run.agentType !== "external-certification")
      throw new CertificationError(
        "bad-request",
        "AgentRun provenance must reference a succeeded external-certification run.",
      );
    if (!run.packetHash || (run.packetHash !== snapshotHash && run.packetHash !== packetHash))
      throw new CertificationError(
        "conflict",
        "AgentRun packet hash is absent or does not match the certification input.",
      );
  }
  if (executionPassportId) {
    const passport = await prisma.executionPassport.findUnique({
      where: { id: executionPassportId },
    });
    if (!passport || passport.verificationStatus !== "verified")
      throw new CertificationError(
        "bad-request",
        "ExecutionPassport provenance must reference a verified passport.",
      );
  }
}
async function replayResult(row: CertificationResult, candidateJson: string) {
  if (row.resultJson !== candidateJson)
    throw new CertificationError("conflict", "This run already has a different immutable result.");
  const events = await prisma.certificationLifecycleEvent.findMany({
    where: { resultId: row.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return mapResult(row, events, true);
}
function mapResult(
  row: CertificationResult,
  events: Pick<CertificationLifecycleEvent, "kind" | "reason" | "createdAt">[],
  replayed = false,
) {
  return {
    id: row.id,
    certificationRunId: row.certificationRunId,
    publicationVersionId: row.publicationVersionId,
    certifierId: row.certifierId,
    certificationProtocolId: row.protocolId,
    inputPacketSha256: row.inputPacketSha256,
    assessmentMode: row.assessmentMode,
    ...JSON.parse(row.resultJson),
    resultSha256: row.resultSha256,
    issuedAt: row.issuedAt.toISOString(),
    lifecycle: events.map((event) => ({
      kind: event.kind,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
    replayed,
    href: `/api/certification-results/${row.id}`,
  };
}
export async function listPublicationVersionCertifications(publicationVersionId: string) {
  const exists = await prisma.publicationVersion.findUnique({
    where: { id: publicationVersionId },
    select: { id: true },
  });
  if (!exists) throw new CertificationError("not-found", "Publication version not found.");
  const rows = await prisma.certificationResult.findMany({
    where: { publicationVersionId },
    include: {
      certifier: true,
      protocol: true,
      lifecycleEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
    orderBy: [{ issuedAt: "asc" }, { id: "asc" }],
  });
  return {
    schemaVersion: "1.0.0",
    publicationVersionId,
    certifications: rows.map((row) =>
      publicCertificationSummarySchema.parse({
        id: row.id,
        publicationVersionId: row.publicationVersionId,
        certifier: { id: row.certifier.id, slug: row.certifier.slug, name: row.certifier.name },
        protocol: {
          id: row.protocol.id,
          seriesKey: row.protocol.seriesKey,
          version: row.protocol.protocolVersion,
          sha256: row.protocol.protocolSha256,
          title: row.protocol.title,
        },
        outcome: row.outcome,
        assessmentMode: row.assessmentMode,
        issuedAt: row.issuedAt.toISOString(),
        lifecycle: row.lifecycleEvents.map((event) => ({
          kind: event.kind,
          reason: event.reason,
          createdAt: event.createdAt.toISOString(),
        })),
        lifecycleState: row.lifecycleEvents.at(-1)?.kind ?? "issued",
        href: `/api/certification-results/${row.id}`,
      }),
    ),
  };
}
export async function getPublicCertificationResult(id: string) {
  const row = await prisma.certificationResult.findUnique({
    where: { id },
    include: {
      certifier: true,
      protocol: true,
      run: true,
      agentRun: true,
      lifecycleEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
  if (!row) throw new CertificationError("not-found", "Certification result not found.");
  return {
    ...mapResult(row, row.lifecycleEvents),
    certifier: { id: row.certifier.id, slug: row.certifier.slug, name: row.certifier.name },
    protocol: {
      id: row.protocol.id,
      seriesKey: row.protocol.seriesKey,
      version: row.protocol.protocolVersion,
      sha256: row.protocol.protocolSha256,
      title: row.protocol.title,
      definition: JSON.parse(row.protocol.protocolJson),
    },
    input: {
      packetSha256: row.run.inputPacketSha256,
      packetSchemaVersion: row.run.packetSchemaVersion,
      capturedAt: row.run.capturedAt.toISOString(),
      completeness: JSON.parse(row.run.completenessJson),
    },
    execution: row.agentRun
      ? {
          agentRunId: row.agentRun.id,
          status: row.agentRun.status,
          agentType: row.agentRun.agentType,
          provider: row.agentRun.modelProvider,
          model: row.agentRun.modelName,
          modelVersion: row.agentRun.modelVersion,
          promptVersion: row.agentRun.promptVersion,
          packetHash: row.agentRun.packetHash,
          startedAt: row.agentRun.startedAt.toISOString(),
          completedAt: row.agentRun.completedAt?.toISOString() ?? null,
        }
      : null,
  };
}
export async function addCertificationLifecycle(
  resultId: string,
  kind: "withdrawn" | "revoked",
  reason: string,
  actor: { userId?: string; certifierId?: string },
) {
  const result = await prisma.certificationResult.findUnique({ where: { id: resultId } });
  if (!result) throw new CertificationError("not-found", "Certification result not found.");
  if (actor.certifierId && actor.certifierId !== result.certifierId)
    throw new CertificationError("forbidden", "Result belongs to another certifier.");
  const existing = await prisma.certificationLifecycleEvent.findFirst({
    where: { resultId, kind },
  });
  if (existing) {
    if (existing.reason !== reason)
      throw new CertificationError("conflict", `A different ${kind} event already exists.`);
    return { id: existing.id, replayed: true };
  }
  try {
    const event = await prisma.certificationLifecycleEvent.create({
      data: {
        resultId,
        kind,
        reason,
        actorUserId: actor.userId,
        actorCertifierId: actor.certifierId,
      },
    });
    return { id: event.id, replayed: false };
  } catch (error) {
    if (prismaCode(error) === "P2002") {
      const raced = await prisma.certificationLifecycleEvent.findUnique({
        where: { resultId_kind: { resultId, kind } },
      });
      if (raced?.reason === reason) return { id: raced.id, replayed: true };
      throw new CertificationError("conflict", `A different ${kind} event already exists.`);
    }
    throw error;
  }
}
function prismaCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}
