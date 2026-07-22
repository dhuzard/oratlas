import "server-only";
import {
  canonicalJson,
  createTrustAdjudicationInputSchema,
  publicTrustAdjudicationSchema,
  type CreateTrustAdjudicationInput,
  type PublicTrustAdjudication,
  type TrustDisagreementCriterionInput,
  type TrustDisagreementReport,
  trustDisagreementCriterionInputSchema,
} from "@oratlas/contracts";
import { detectTrustCriterionDisagreements } from "@oratlas/trust";
import { type Prisma } from "@oratlas/db";
import { prisma } from "./db";
import { sha256 } from "./hash";
import {
  loadedNodeRelationTrustInclude,
  resolveLoadedNodeRelationTrustAssessment,
  resolveLoadedTrustAssessment,
} from "./trust-provenance";
import { trustCriterionProfileFromJson } from "./trust-profile";

export class TrustAdjudicationError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "not-found" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "TrustAdjudicationError";
  }
}

export interface TrustAdjudicationActor {
  id: string;
  githubLogin: string;
  role: string;
}

interface AssessmentSnapshot {
  id: string;
  hash: string;
  protocolVersion: string;
  assessorType: string;
  assessorId?: string;
  assessedAt?: string;
  criteria: TrustDisagreementCriterionInput[];
}

interface DisagreementGroup {
  subjectType: "claim-citation" | "node-relation";
  subjectId: string;
  subjectHref: string;
  subjectLabel: string;
  protocolVersion: string;
  assessments: AssessmentSnapshot[];
  report: TrustDisagreementReport;
  disagreementHash: string;
  directlyInvolvedUserIds: string[];
  contributorGithubLogins: string[];
}

export interface TrustDisagreementScope {
  reviewVersionId?: string;
  claimEvidenceRelationId?: string;
  nodeEdgeProposalId?: string;
}

export interface TrustDisagreementQueueItem extends Omit<
  DisagreementGroup,
  "directlyInvolvedUserIds" | "contributorGithubLogins"
> {
  adjudications: PublicTrustAdjudication[];
  current: boolean;
  open: boolean;
}

function criteriaInput(criteriaJson: Record<string, string | null>) {
  return trustCriterionProfileFromJson(criteriaJson).map((row) => {
    if (row.status === "invalid") {
      throw new TrustAdjudicationError(
        `Stored TRUST criterion ${row.criterion} is invalid.`,
        "conflict",
      );
    }
    if (row.status === "assessed") {
      return trustDisagreementCriterionInputSchema.parse({
        criterion: row.criterion,
        status: "assessed" as const,
        rating: row.rating as "very-low" | "low" | "moderate" | "high" | "very-high",
      });
    }
    return trustDisagreementCriterionInputSchema.parse({
      criterion: row.criterion,
      status:
        row.status === "not-applicable" ? ("not-applicable" as const) : ("not-assessed" as const),
      rating:
        row.status === "not-applicable" ? ("not-applicable" as const) : ("not-assessed" as const),
    });
  });
}

function disagreementHash(group: Omit<DisagreementGroup, "disagreementHash">): string {
  return sha256(
    canonicalJson({
      subjectType: group.subjectType,
      subjectId: group.subjectId,
      protocolVersion: group.protocolVersion,
      assessments: group.assessments.map(({ id, hash }) => ({ id, hash })),
      report: group.report,
    }),
  );
}

function buildGroup(
  input: Omit<DisagreementGroup, "report" | "disagreementHash">,
): DisagreementGroup {
  const assessments = [...input.assessments].sort((left, right) => left.id.localeCompare(right.id));
  const report = detectTrustCriterionDisagreements({
    assessments: assessments.map((assessment) => ({
      assessmentId: assessment.id,
      protocolVersion: assessment.protocolVersion,
      criteria: assessment.criteria,
    })),
  });
  const partial = { ...input, assessments, report };
  return { ...partial, disagreementHash: disagreementHash(partial) };
}

type StoredAdjudication = Prisma.TrustAdjudicationGetPayload<{
  include: { references: true };
}>;

function publicAdjudication(
  row: StoredAdjudication,
  current: Map<string, string>,
  resolvedGroup?: DisagreementGroup,
) {
  const orderedReferences = row.references.slice().sort((a, b) => a.position - b.position);
  const referencesValid =
    row.references.length >= 2 &&
    orderedReferences.every(
      (reference) => current.get(reference.assessmentId) === reference.assessmentHash,
    ) &&
    new Set(orderedReferences.map(({ assessmentId }) => assessmentId)).size ===
      orderedReferences.length &&
    (row.selectedAssessmentId === null ||
      orderedReferences.some(({ assessmentId }) => assessmentId === row.selectedAssessmentId));
  const disagreementValid = resolvedGroup?.disagreementHash === row.disagreementHash;
  const outcomeHash = sha256(
    canonicalJson({
      disagreementHash: row.disagreementHash,
      references: orderedReferences.map(({ assessmentId, assessmentHash }) => ({
        assessmentId,
        assessmentHash,
      })),
      outcome: row.outcome,
      selectedAssessmentId: row.selectedAssessmentId,
      adjudicatorGithubLogin: row.adjudicatorGithubLoginSnapshot,
      adjudicatorRoleSnapshot: row.adjudicatorRoleSnapshot,
      rationaleHash: row.rationaleHash,
      conflictOfInterest: { status: row.conflictOfInterestStatus },
      administratorOverride: row.administratorOverride
        ? {
            administrator: { githubLogin: row.administratorOverrideGithubLoginSnapshot },
            exercisedAt: row.administratorOverrideAt?.toISOString(),
          }
        : null,
    }),
  );
  const parsed = publicTrustAdjudicationSchema.safeParse({
    id: row.id,
    subjectType: row.subjectType,
    protocolVersion: row.protocolVersion,
    assessmentIds: orderedReferences.map((reference) => reference.assessmentId),
    outcome: row.outcome,
    selectedAssessmentId: row.selectedAssessmentId ?? undefined,
    adjudicator: { githubLogin: row.adjudicatorGithubLoginSnapshot },
    conflictOfInterest: { status: row.conflictOfInterestStatus },
    administratorOverride:
      row.administratorOverride &&
      row.administratorOverrideGithubLoginSnapshot &&
      row.administratorOverrideAt
        ? {
            administrator: { githubLogin: row.administratorOverrideGithubLoginSnapshot },
            exercisedAt: row.administratorOverrideAt.toISOString(),
          }
        : undefined,
    disagreementHash: row.disagreementHash,
    outcomeHash: row.outcomeHash,
    createdAt: row.createdAt.toISOString(),
    valid: referencesValid && disagreementValid && outcomeHash === row.outcomeHash,
  });
  return parsed.success ? parsed.data : null;
}

async function loadHistoricalAssessmentState(
  adjudications: readonly StoredAdjudication[],
): Promise<{
  hashes: Map<string, string>;
  groups: Map<string, DisagreementGroup>;
}> {
  const claimIds = new Set<string>();
  const nodeIds = new Set<string>();
  for (const adjudication of adjudications) {
    for (const reference of adjudication.references) {
      if (reference.trustAssessmentId) claimIds.add(reference.trustAssessmentId);
      if (reference.nodeRelationTrustAssessmentId) {
        nodeIds.add(reference.nodeRelationTrustAssessmentId);
      }
    }
  }
  const [claimRows, nodeRows] = await Promise.all([
    prisma.trustAssessment.findMany({
      where: { id: { in: [...claimIds] } },
      include: {
        verification: { include: { reviewer: true } },
        challenges: { select: { challengerId: true } },
        relation: {
          include: {
            citation: true,
            challenges: { select: { challengerId: true } },
            claim: { include: { reviewVersion: { include: { review: true } } } },
          },
        },
      },
    }),
    prisma.nodeRelationTrustAssessment.findMany({
      where: { id: { in: [...nodeIds] } },
      include: loadedNodeRelationTrustInclude,
    }),
  ]);
  const claimById = new Map(claimRows.map((row) => [row.id, row]));
  const nodeById = new Map(nodeRows.map((row) => [row.id, row]));
  const hashes = new Map<string, string>();
  for (const row of claimRows) hashes.set(row.id, resolveLoadedTrustAssessment(row).currentHash);
  for (const row of nodeRows) {
    hashes.set(row.id, resolveLoadedNodeRelationTrustAssessment(row).currentHash);
  }
  const groups = new Map<string, DisagreementGroup>();
  for (const adjudication of adjudications) {
    const ordered = adjudication.references.slice().sort((a, b) => a.position - b.position);
    if (adjudication.subjectType === "claim-citation") {
      const rows = ordered.flatMap((reference) => {
        const row = reference.trustAssessmentId
          ? claimById.get(reference.trustAssessmentId)
          : undefined;
        return row ? [row] : [];
      });
      const first = rows[0];
      if (!first || rows.length !== ordered.length) continue;
      const group = buildGroup({
        subjectType: "claim-citation",
        subjectId: first.claimEvidenceRelationId,
        subjectHref: `/reviews/${first.relation.claim.reviewVersion.review.slug}#claim-${encodeURIComponent(first.relation.claim.localClaimId)}`,
        subjectLabel: `${first.relation.claim.localClaimId} ↔ ${first.relation.citation.localCitationId}`,
        protocolVersion: adjudication.protocolVersion,
        assessments: rows.map((row) => {
          const resolved = resolveLoadedTrustAssessment(row);
          return {
            id: row.id,
            hash: resolved.currentHash,
            protocolVersion: row.protocolVersion,
            assessorType: row.assessorType,
            assessorId: row.assessorId ?? undefined,
            assessedAt: row.assessedAt?.toISOString(),
            criteria: criteriaInput(resolved.subject.assessment.criteriaJson),
          };
        }),
        directlyInvolvedUserIds: [],
        contributorGithubLogins: [],
      });
      const sameSubject = rows.every(
        (row) =>
          row.claimEvidenceRelationId === adjudication.claimEvidenceRelationId &&
          row.protocolVersion === adjudication.protocolVersion,
      );
      if (sameSubject) groups.set(adjudication.id, group);
    } else {
      const rows = ordered.flatMap((reference) => {
        const row = reference.nodeRelationTrustAssessmentId
          ? nodeById.get(reference.nodeRelationTrustAssessmentId)
          : undefined;
        return row ? [row] : [];
      });
      const first = rows[0];
      if (!first || rows.length !== ordered.length) continue;
      const group = buildGroup({
        subjectType: "node-relation",
        subjectId: first.nodeEdgeProposalId,
        subjectHref: `/nodes/${first.proposal.sourceNodeVersion.knowledgeNodeId}/versions/${first.proposal.sourceNodeVersionId}`,
        subjectLabel: `${first.proposal.sourceNodeVersion.knowledgeNode.localNodeId} → ${first.proposal.targetNodeVersion.knowledgeNode.localNodeId}`,
        protocolVersion: adjudication.protocolVersion,
        assessments: rows.map((row) => {
          const resolved = resolveLoadedNodeRelationTrustAssessment(row);
          return {
            id: row.id,
            hash: resolved.currentHash,
            protocolVersion: row.protocolVersion,
            assessorType: row.assessorType,
            assessorId: row.assessorId ?? undefined,
            assessedAt: row.assessedAt?.toISOString(),
            criteria: criteriaInput(resolved.subject.assessment.criteriaJson),
          };
        }),
        directlyInvolvedUserIds: [],
        contributorGithubLogins: [],
      });
      const sameSubject = rows.every(
        (row) =>
          row.nodeEdgeProposalId === adjudication.nodeEdgeProposalId &&
          row.protocolVersion === adjudication.protocolVersion,
      );
      if (sameSubject) groups.set(adjudication.id, group);
    }
  }
  return { hashes, groups };
}

async function loadGroups(
  client: Pick<
    Prisma.TransactionClient,
    "trustAssessment" | "nodeRelationTrustAssessment"
  > = prisma,
  scope: TrustDisagreementScope = {},
): Promise<DisagreementGroup[]> {
  const [claimRows, nodeRows] = await Promise.all([
    client.trustAssessment.findMany({
      where: {
        supersededBy: { none: {} },
        ...(scope.reviewVersionId
          ? { relation: { claim: { reviewVersionId: scope.reviewVersionId } } }
          : {}),
        ...(scope.claimEvidenceRelationId
          ? { claimEvidenceRelationId: scope.claimEvidenceRelationId }
          : {}),
      },
      take: 10_001,
      include: {
        verification: { include: { reviewer: true } },
        challenges: { select: { challengerId: true } },
        relation: {
          include: {
            citation: true,
            challenges: { select: { challengerId: true } },
            claim: {
              include: {
                reviewVersion: {
                  include: { review: true, contributors: { include: { person: true } } },
                },
              },
            },
          },
        },
      },
    }),
    scope.reviewVersionId || scope.claimEvidenceRelationId
      ? Promise.resolve([])
      : client.nodeRelationTrustAssessment.findMany({
          where: {
            supersededBy: { none: {} },
            ...(scope.nodeEdgeProposalId ? { nodeEdgeProposalId: scope.nodeEdgeProposalId } : {}),
          },
          take: 10_001,
          include: loadedNodeRelationTrustInclude,
        }),
  ]);
  if (claimRows.length > 10_000 || nodeRows.length > 10_000) {
    throw new TrustAdjudicationError(
      "TRUST disagreement query exceeds the bounded queue limit.",
      "conflict",
    );
  }
  const groups = new Map<string, DisagreementGroup>();
  for (const row of claimRows) {
    const resolved = resolveLoadedTrustAssessment(row);
    const key = `claim-citation:${row.claimEvidenceRelationId}:${row.protocolVersion}`;
    const existing = groups.get(key);
    if ((existing?.assessments.length ?? 0) >= 100) {
      throw new TrustAdjudicationError(
        "A same-protocol disagreement set exceeds 100 assessments.",
        "conflict",
      );
    }
    const snapshot: AssessmentSnapshot = {
      id: row.id,
      hash: resolved.currentHash,
      protocolVersion: row.protocolVersion,
      assessorType: row.assessorType,
      assessorId: row.assessorId ?? undefined,
      assessedAt: row.assessedAt?.toISOString(),
      criteria: criteriaInput(resolved.subject.assessment.criteriaJson),
    };
    const base =
      existing ??
      buildGroup({
        subjectType: "claim-citation",
        subjectId: row.claimEvidenceRelationId,
        subjectHref: `/reviews/${row.relation.claim.reviewVersion.review.slug}#claim-${encodeURIComponent(row.relation.claim.localClaimId)}`,
        subjectLabel: `${row.relation.claim.localClaimId} ↔ ${row.relation.citation.localCitationId}`,
        protocolVersion: row.protocolVersion,
        assessments: [],
        directlyInvolvedUserIds: [
          ...row.challenges.map(({ challengerId }) => challengerId),
          ...row.relation.challenges.map(({ challengerId }) => challengerId),
        ],
        contributorGithubLogins: row.relation.claim.reviewVersion.contributors
          .map((contributor) => contributor.person.githubLogin)
          .filter((login): login is string => Boolean(login)),
      });
    groups.set(
      key,
      buildGroup({
        ...base,
        assessments: [...base.assessments, snapshot],
        directlyInvolvedUserIds: [
          ...new Set([
            ...base.directlyInvolvedUserIds,
            ...row.challenges.map(({ challengerId }) => challengerId),
            ...row.relation.challenges.map(({ challengerId }) => challengerId),
          ]),
        ],
      }),
    );
  }
  for (const row of nodeRows) {
    const resolved = resolveLoadedNodeRelationTrustAssessment(row);
    const key = `node-relation:${row.nodeEdgeProposalId}:${row.protocolVersion}`;
    const existing = groups.get(key);
    if ((existing?.assessments.length ?? 0) >= 100) {
      throw new TrustAdjudicationError(
        "A same-protocol disagreement set exceeds 100 assessments.",
        "conflict",
      );
    }
    const snapshot: AssessmentSnapshot = {
      id: row.id,
      hash: resolved.currentHash,
      protocolVersion: row.protocolVersion,
      assessorType: row.assessorType,
      assessorId: row.assessorId ?? undefined,
      assessedAt: row.assessedAt?.toISOString(),
      criteria: criteriaInput(resolved.subject.assessment.criteriaJson),
    };
    const base =
      existing ??
      buildGroup({
        subjectType: "node-relation",
        subjectId: row.nodeEdgeProposalId,
        subjectHref: `/nodes/${row.proposal.sourceNodeVersion.knowledgeNodeId}/versions/${row.proposal.sourceNodeVersionId}`,
        subjectLabel: `${row.proposal.sourceNodeVersion.knowledgeNode.localNodeId} → ${row.proposal.targetNodeVersion.knowledgeNode.localNodeId}`,
        protocolVersion: row.protocolVersion,
        assessments: [],
        directlyInvolvedUserIds: [
          row.proposal.sourceNodeVersion.sourceSubmission?.submitterId,
        ].filter((id): id is string => Boolean(id)),
        contributorGithubLogins: [],
      });
    groups.set(key, buildGroup({ ...base, assessments: [...base.assessments, snapshot] }));
  }
  return [...groups.values()];
}

export async function listTrustDisagreementQueue(
  scope: TrustDisagreementScope = {},
): Promise<TrustDisagreementQueueItem[]> {
  const groups = await loadGroups(prisma, scope);
  const adjudications = await prisma.trustAdjudication.findMany({
    where: scope.reviewVersionId
      ? { claimEvidenceRelation: { claim: { reviewVersionId: scope.reviewVersionId } } }
      : scope.claimEvidenceRelationId
        ? { claimEvidenceRelationId: scope.claimEvidenceRelationId }
        : scope.nodeEdgeProposalId
          ? { nodeEdgeProposalId: scope.nodeEdgeProposalId }
          : undefined,
    take: 10_001,
    include: { references: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (adjudications.length > 10_000) {
    throw new TrustAdjudicationError(
      "TRUST adjudication history exceeds the bounded queue limit.",
      "conflict",
    );
  }
  const historical = await loadHistoricalAssessmentState(adjudications);
  const currentItems = groups
    .filter((group) => group.report.disagreements.length > 0)
    .map((group) => {
      const {
        directlyInvolvedUserIds: _involved,
        contributorGithubLogins: _contributors,
        ...publicGroup
      } = group;
      const history = adjudications
        .filter(
          (row) =>
            row.subjectType === group.subjectType &&
            row.protocolVersion === group.protocolVersion &&
            (group.subjectType === "claim-citation"
              ? row.claimEvidenceRelationId === group.subjectId
              : row.nodeEdgeProposalId === group.subjectId),
        )
        .filter((row) => row.disagreementHash === group.disagreementHash)
        .map((row) => publicAdjudication(row, historical.hashes, group))
        .filter((row): row is PublicTrustAdjudication => row !== null);
      return {
        ...publicGroup,
        adjudications: history,
        current: true,
        open:
          group.report.disagreements.length > 0 &&
          !history.some(
            (adjudication) =>
              adjudication.valid && adjudication.disagreementHash === group.disagreementHash,
          ),
      };
    });
  const currentHashes = new Set(currentItems.map(({ disagreementHash }) => disagreementHash));
  const historicalItems = adjudications.flatMap((row) => {
    if (currentHashes.has(row.disagreementHash)) return [];
    const group = historical.groups.get(row.id);
    const projected = publicAdjudication(row, historical.hashes, group);
    if (!projected) return [];
    if (!group) return [];
    const {
      directlyInvolvedUserIds: _involved,
      contributorGithubLogins: _contributors,
      ...publicGroup
    } = group;
    return [{ ...publicGroup, adjudications: [projected], current: false, open: false }];
  });
  return [...currentItems, ...historicalItems].sort(
    (left, right) =>
      left.subjectType.localeCompare(right.subjectType) ||
      left.subjectLabel.localeCompare(right.subjectLabel) ||
      left.protocolVersion.localeCompare(right.protocolVersion),
  );
}

async function hasAuthority(tx: Prisma.TransactionClient, actorId: string, role: string) {
  if (role === "EDITOR" || role === "ADMIN") return true;
  return Boolean(
    await tx.trustAdjudicatorDesignation.findFirst({
      where: { userId: actorId, active: true, revokedAt: null },
      select: { id: true },
    }),
  );
}

export async function isTrustAdjudicator(actorId: string, role: string): Promise<boolean> {
  if (role === "EDITOR" || role === "ADMIN") return true;
  return Boolean(
    await prisma.trustAdjudicatorDesignation.findFirst({
      where: { userId: actorId, active: true, revokedAt: null },
      select: { id: true },
    }),
  );
}

export async function setTrustAdjudicatorDesignation(
  actor: TrustAdjudicationActor,
  userId: string,
  active: boolean,
): Promise<{ userId: string; active: boolean }> {
  if (actor.role !== "ADMIN") {
    throw new TrustAdjudicationError("Administrator role required.", "forbidden");
  }
  return prisma.$transaction(async (tx) => {
    const [currentActor, user] = await Promise.all([
      tx.user.findUnique({ where: { id: actor.id }, select: { role: true } }),
      tx.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);
    if (currentActor?.role !== "ADMIN") {
      throw new TrustAdjudicationError("Administrator role required.", "forbidden");
    }
    if (!user) throw new TrustAdjudicationError("User not found.", "not-found");
    const designation = await tx.trustAdjudicatorDesignation.upsert({
      where: { userId },
      update: { active, revokedAt: active ? null : new Date(), designatedById: actor.id },
      create: {
        userId,
        designatedById: actor.id,
        active,
        revokedAt: active ? null : new Date(),
      },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: active ? "trust.adjudicator-designated" : "trust.adjudicator-revoked",
        subjectType: "user",
        subjectId: userId,
        detailsJson: canonicalJson({ designationId: designation.id, active }),
      },
    });
    return { userId, active };
  });
}

export async function createTrustAdjudication(
  actor: TrustAdjudicationActor,
  input: CreateTrustAdjudicationInput,
): Promise<PublicTrustAdjudication> {
  const parsed = createTrustAdjudicationInputSchema.parse(input);
  return prisma.$transaction(async (tx) => {
    const currentActor = await tx.user.findUnique({
      where: { id: actor.id },
      select: { role: true, githubLogin: true },
    });
    if (!currentActor || !(await hasAuthority(tx, actor.id, currentActor.role))) {
      throw new TrustAdjudicationError(
        "Editor or designated adjudicator authority required.",
        "forbidden",
      );
    }
    const subjectScope: TrustDisagreementScope = {};
    if (parsed.subjectType === "claim-citation") {
      const reference = await tx.trustAssessment.findUnique({
        where: { id: parsed.assessmentIds[0] },
        select: { claimEvidenceRelationId: true },
      });
      if (!reference)
        throw new TrustAdjudicationError("Referenced assessment not found.", "not-found");
      subjectScope.claimEvidenceRelationId = reference.claimEvidenceRelationId;
    } else {
      const reference = await tx.nodeRelationTrustAssessment.findUnique({
        where: { id: parsed.assessmentIds[0] },
        select: { nodeEdgeProposalId: true },
      });
      if (!reference)
        throw new TrustAdjudicationError("Referenced assessment not found.", "not-found");
      subjectScope.nodeEdgeProposalId = reference.nodeEdgeProposalId;
    }
    const groups = await loadGroups(tx, subjectScope);
    const requestedIds = [...parsed.assessmentIds].sort();
    const group = groups.find(
      (candidate) =>
        candidate.subjectType === parsed.subjectType &&
        candidate.report.disagreements.length > 0 &&
        candidate.assessments
          .map(({ id }) => id)
          .sort()
          .join("\0") === requestedIds.join("\0"),
    );
    if (!group) {
      throw new TrustAdjudicationError(
        "Referenced assessments are not one current, same-protocol disagreement set.",
        "conflict",
      );
    }
    if (group.disagreementHash !== parsed.expectedDisagreementHash) {
      throw new TrustAdjudicationError("Disagreement changed. Refresh and retry.", "conflict");
    }
    const actorLogin = currentActor.githubLogin.normalize("NFKC").toLowerCase();
    const directlyInvolved =
      group.directlyInvolvedUserIds.includes(actor.id) ||
      group.contributorGithubLogins.some(
        (login) => login.normalize("NFKC").toLowerCase() === actorLogin,
      ) ||
      group.assessments.some(
        (assessment) => assessment.assessorId?.normalize("NFKC").toLowerCase() === actorLogin,
      );
    if (directlyInvolved && !parsed.administratorOverride) {
      throw new TrustAdjudicationError("Direct involvement requires recusal.", "forbidden");
    }
    if (parsed.administratorOverride) {
      if (!directlyInvolved) {
        throw new TrustAdjudicationError("ADMIN override is valid only for direct involvement.");
      }
      if (currentActor.role !== "ADMIN") {
        throw new TrustAdjudicationError(
          "Administrator role required for a recusal override.",
          "forbidden",
        );
      }
      if (parsed.conflictOfInterest.status !== "conflict-declared") {
        throw new TrustAdjudicationError(
          "A public conflict declaration is required for a recusal override.",
        );
      }
    }
    const existing = await tx.trustAdjudication.findUnique({
      where: { disagreementHash: group.disagreementHash },
      include: { references: true },
    });
    const rationaleHash = sha256(parsed.rationale);
    const overrideAt = parsed.administratorOverride
      ? (existing?.administratorOverrideAt ?? new Date())
      : null;
    const outcomeHash = sha256(
      canonicalJson({
        disagreementHash: group.disagreementHash,
        references: group.assessments.map(({ id, hash }) => ({
          assessmentId: id,
          assessmentHash: hash,
        })),
        outcome: parsed.outcome,
        selectedAssessmentId: parsed.selectedAssessmentId ?? null,
        adjudicatorGithubLogin: currentActor.githubLogin,
        adjudicatorRoleSnapshot: currentActor.role,
        rationaleHash,
        conflictOfInterest: parsed.conflictOfInterest,
        administratorOverride: parsed.administratorOverride
          ? {
              administrator: { githubLogin: currentActor.githubLogin },
              exercisedAt: overrideAt?.toISOString(),
            }
          : null,
      }),
    );
    if (existing) {
      if (existing.outcomeHash !== outcomeHash) {
        throw new TrustAdjudicationError(
          "This disagreement already has a different immutable adjudication.",
          "conflict",
        );
      }
      const projected = publicAdjudication(
        existing,
        new Map(group.assessments.map(({ id, hash }) => [id, hash])),
        group,
      );
      if (!projected?.valid)
        throw new TrustAdjudicationError("Stored adjudication integrity failed.", "conflict");
      return projected;
    }
    const row = await tx.trustAdjudication.create({
      data: {
        subjectType: group.subjectType,
        claimEvidenceRelationId: group.subjectType === "claim-citation" ? group.subjectId : null,
        nodeEdgeProposalId: group.subjectType === "node-relation" ? group.subjectId : null,
        protocolVersion: group.protocolVersion,
        outcome: parsed.outcome,
        selectedAssessmentId: parsed.selectedAssessmentId,
        adjudicatorId: actor.id,
        adjudicatorRoleSnapshot: currentActor.role,
        adjudicatorGithubLoginSnapshot: currentActor.githubLogin,
        rationale: parsed.rationale,
        rationaleHash,
        conflictOfInterestStatus: parsed.conflictOfInterest.status,
        administratorOverride: parsed.administratorOverride,
        administratorOverrideById: parsed.administratorOverride ? actor.id : null,
        administratorOverrideGithubLoginSnapshot: parsed.administratorOverride
          ? currentActor.githubLogin
          : null,
        administratorOverrideAt: overrideAt,
        disagreementHash: group.disagreementHash,
        outcomeHash,
        references: {
          create: group.assessments.map((assessment, position) => ({
            position,
            assessmentId: assessment.id,
            assessmentHash: assessment.hash,
            trustAssessmentId: group.subjectType === "claim-citation" ? assessment.id : null,
            nodeRelationTrustAssessmentId:
              group.subjectType === "node-relation" ? assessment.id : null,
          })),
        },
      },
      include: { references: true },
    });
    await tx.idempotencyKey.create({
      data: { key: `trust.adjudication:${group.disagreementHash}`, requestHash: outcomeHash },
    });
    await tx.auditEvent.create({
      data: {
        actorId: actor.id,
        action: "trust.adjudication-created",
        subjectType: group.subjectType,
        subjectId: group.subjectId,
        idempotencyKey: `trust.adjudication:${group.disagreementHash}`,
        detailsJson: canonicalJson({
          adjudicationId: row.id,
          assessmentIds: requestedIds,
          disagreementHash: group.disagreementHash,
          outcome: parsed.outcome,
          selectedAssessmentId: parsed.selectedAssessmentId ?? null,
          outcomeHash,
          conflictOfInterest: parsed.conflictOfInterest,
          administratorOverride: parsed.administratorOverride,
        }),
      },
    });
    const projected = publicAdjudication(
      row,
      new Map(group.assessments.map(({ id, hash }) => [id, hash])),
      group,
    );
    if (!projected) throw new TrustAdjudicationError("Adjudication projection failed.", "conflict");
    return projected;
  });
}
