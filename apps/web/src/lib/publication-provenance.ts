import "server-only";
import {
  canonicalJson,
  publicationProductionAssertionMutationSchema,
  publicationProductionProvenanceResponseSchema,
  publicationRelationMutationSchema,
  publicationRelationsResponseSchema,
  publicPublicationProductionAssertionSchema,
  publicPublicationRelationSchema,
  PUBLICATION_PRODUCTION_ASSERTION_LIMIT,
  PUBLICATION_RELATION_LIMIT,
  type PublicationProductionAssertionMutation,
  type PublicationRelationMutation,
} from "@oratlas/contracts";
import { prisma } from "./db";

export class PublicationProvenanceError extends Error {
  constructor(
    public readonly code: "not-found" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "PublicationProvenanceError";
  }
}

const assertionInclude = {
  assertedBy: { select: { id: true, githubLogin: true } },
  supersededBy: { select: { id: true } },
} as const;

type LoadedAssertion = Awaited<
  ReturnType<typeof prisma.publicationProductionAssertion.findFirstOrThrow>
> & {
  assertedBy: { id: string; githubLogin: string } | null;
  supersededBy: { id: string } | null;
};

function parseJsonArray(value: string, label: string): unknown[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fail closed below.
  }
  throw new PublicationProvenanceError("conflict", `Stored ${label} is invalid.`);
}

function mapAssertion(assertion: LoadedAssertion) {
  return publicPublicationProductionAssertionSchema.parse({
    id: assertion.id,
    publicationVersionId: assertion.publicationVersionId,
    sourceAssertionKey: assertion.sourceAssertionKey,
    mode: assertion.mode,
    actors: parseJsonArray(assertion.actorsJson, "production actors"),
    activities: parseJsonArray(assertion.activitiesJson, "production activities"),
    statement: assertion.statement,
    strength: assertion.strength,
    lifecycleState: assertion.supersededBy ? "superseded" : "active",
    publicEvidenceUrl: assertion.publicEvidenceUrl,
    agentRunId: assertion.agentRunId,
    executionPassportId: assertion.executionPassportId,
    supersedesAssertionId: assertion.supersedesAssertionId,
    supersededByAssertionId: assertion.supersededBy?.id ?? null,
    assertedBy: assertion.assertedBy,
    assertedAt: assertion.assertedAt.toISOString(),
    links: {
      publicationVersion: `/api/publication-versions/${assertion.publicationVersionId}`,
      executionPassport: assertion.executionPassportId
        ? `/api/execution-passports/${assertion.executionPassportId}`
        : null,
      publicEvidence: assertion.publicEvidenceUrl,
    },
  });
}

export async function listPublicationProductionProvenance(publicationVersionId: string) {
  const version = await prisma.publicationVersion.findUnique({
    where: { id: publicationVersionId },
    select: { id: true },
  });
  if (!version) throw new PublicationProvenanceError("not-found", "Publication version not found.");
  const [rows, total] = await Promise.all([
    prisma.publicationProductionAssertion.findMany({
      where: { publicationVersionId },
      include: assertionInclude,
      orderBy: [{ assertedAt: "asc" }, { id: "asc" }],
      take: PUBLICATION_PRODUCTION_ASSERTION_LIMIT,
    }),
    prisma.publicationProductionAssertion.count({ where: { publicationVersionId } }),
  ]);
  return publicationProductionProvenanceResponseSchema.parse({
    schemaVersion: "1.0.0",
    publicationVersionId,
    assertions: rows.map((row) => mapAssertion(row as LoadedAssertion)),
    completeness: { returned: rows.length, total, truncated: rows.length < total },
  });
}

export async function createPublicationProductionAssertion(
  publicationVersionId: string,
  input: PublicationProductionAssertionMutation,
  actorId: string,
) {
  const mutation = publicationProductionAssertionMutationSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const version = await tx.publicationVersion.findUnique({
      where: { id: publicationVersionId },
      select: { id: true },
    });
    if (!version) {
      throw new PublicationProvenanceError("not-found", "Publication version not found.");
    }
    if (mutation.agentRunId) {
      const run = await tx.agentRun.findUnique({
        where: { id: mutation.agentRunId },
        select: { status: true },
      });
      if (!run || run.status !== "succeeded") {
        throw new PublicationProvenanceError(
          "conflict",
          "ORAtlas-attested production provenance requires a succeeded AgentRun.",
        );
      }
    }
    if (mutation.executionPassportId) {
      const passport = await tx.executionPassport.findUnique({
        where: { id: mutation.executionPassportId },
        select: { verificationStatus: true },
      });
      if (!passport || passport.verificationStatus !== "verified") {
        throw new PublicationProvenanceError(
          "conflict",
          "ORAtlas-attested production provenance requires a verified ExecutionPassport.",
        );
      }
    }
    if (mutation.supersedesAssertionId) {
      const prior = await tx.publicationProductionAssertion.findUnique({
        where: { id: mutation.supersedesAssertionId },
        include: { supersededBy: { select: { id: true } } },
      });
      if (!prior || prior.publicationVersionId !== publicationVersionId) {
        throw new PublicationProvenanceError(
          "conflict",
          "A production correction must supersede an assertion on the same exact version.",
        );
      }
      if (prior.supersededBy) {
        throw new PublicationProvenanceError(
          "conflict",
          "The production assertion has already been superseded.",
        );
      }
    }
    const now = new Date();
    const created = await tx.publicationProductionAssertion.create({
      data: {
        publicationVersionId,
        mode: mutation.mode,
        actorsJson: canonicalJson(mutation.actors),
        activitiesJson: canonicalJson(mutation.activities),
        statement: mutation.statement,
        strength: mutation.strength,
        publicEvidenceUrl: mutation.publicEvidenceUrl,
        agentRunId: mutation.agentRunId,
        executionPassportId: mutation.executionPassportId,
        supersedesAssertionId: mutation.supersedesAssertionId,
        assertedById: actorId,
        assertedAt: now,
      },
      include: assertionInclude,
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "publication-production.assert",
        subjectType: "publication-production-assertion",
        subjectId: created.id,
        detailsJson: canonicalJson({
          publicationVersionId,
          mode: mutation.mode,
          strength: mutation.strength,
          supersedesAssertionId: mutation.supersedesAssertionId ?? null,
        }),
      },
    });
    return mapAssertion(created as LoadedAssertion);
  });
}

const relationInclude = {
  reviewedBy: { select: { id: true, githubLogin: true } },
} as const;

type LoadedRelation = Awaited<ReturnType<typeof prisma.publicationRelation.findFirstOrThrow>> & {
  reviewedBy: { id: string; githubLogin: string };
};

function mapRelation(relation: LoadedRelation, publicationId: string) {
  return publicPublicationRelationSchema.parse({
    id: relation.id,
    sourcePublicationId: relation.sourcePublicationId,
    targetPublicationId: relation.targetPublicationId,
    relationType: relation.relationType,
    direction: relation.sourcePublicationId === publicationId ? "outgoing" : "incoming",
    rationale: relation.rationale,
    publicEvidenceUrl: relation.publicEvidenceUrl,
    reviewedBy: relation.reviewedBy,
    reviewedAt: relation.reviewedAt.toISOString(),
    links: {
      sourcePublication: `/api/publications/${relation.sourcePublicationId}`,
      targetPublication: `/api/publications/${relation.targetPublicationId}`,
      publicEvidence: relation.publicEvidenceUrl,
    },
  });
}

export async function listPublicationRelations(publicationId: string) {
  const publication = await prisma.publication.findUnique({
    where: { id: publicationId },
    select: { id: true },
  });
  if (!publication) throw new PublicationProvenanceError("not-found", "Publication not found.");
  const where = {
    OR: [{ sourcePublicationId: publicationId }, { targetPublicationId: publicationId }],
  };
  const [rows, total] = await Promise.all([
    prisma.publicationRelation.findMany({
      where,
      include: relationInclude,
      orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
      take: PUBLICATION_RELATION_LIMIT,
    }),
    prisma.publicationRelation.count({ where }),
  ]);
  return publicationRelationsResponseSchema.parse({
    schemaVersion: "1.0.0",
    publicationId,
    relations: rows.map((row) => mapRelation(row as LoadedRelation, publicationId)),
    completeness: { returned: rows.length, total, truncated: rows.length < total },
  });
}

export async function createPublicationRelation(
  sourcePublicationId: string,
  input: PublicationRelationMutation,
  actorId: string,
) {
  const mutation = publicationRelationMutationSchema.parse(input);
  if (sourcePublicationId === mutation.targetPublicationId) {
    throw new PublicationProvenanceError(
      "conflict",
      "A transfer relationship requires two distinct publication records.",
    );
  }
  return prisma.$transaction(async (tx) => {
    const count = await tx.publication.count({
      where: { id: { in: [sourcePublicationId, mutation.targetPublicationId] } },
    });
    if (count !== 2) {
      throw new PublicationProvenanceError("not-found", "Publication not found.");
    }
    const existing = await tx.publicationRelation.findUnique({
      where: {
        sourcePublicationId_targetPublicationId_relationType: {
          sourcePublicationId,
          targetPublicationId: mutation.targetPublicationId,
          relationType: mutation.relationType,
        },
      },
      include: relationInclude,
    });
    if (existing) return mapRelation(existing as LoadedRelation, sourcePublicationId);
    const now = new Date();
    const created = await tx.publicationRelation.create({
      data: {
        sourcePublicationId,
        targetPublicationId: mutation.targetPublicationId,
        relationType: mutation.relationType,
        rationale: mutation.rationale,
        publicEvidenceUrl: mutation.publicEvidenceUrl,
        reviewedById: actorId,
        reviewedAt: now,
      },
      include: relationInclude,
    });
    await tx.auditEvent.create({
      data: {
        actorId,
        action: "publication-relation.review",
        subjectType: "publication-relation",
        subjectId: created.id,
        detailsJson: canonicalJson({
          sourcePublicationId,
          targetPublicationId: mutation.targetPublicationId,
          relationType: mutation.relationType,
        }),
      },
    });
    return mapRelation(created as LoadedRelation, sourcePublicationId);
  });
}
