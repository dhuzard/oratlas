import "server-only";
import { nodeRelationTypeSchema, publicGraphTrustSchema } from "@oratlas/contracts";
import { prisma } from "./db";
import {
  graphTrustLookupKey,
  type GraphTrustLookupKey,
  type GraphTrustProvider,
} from "./graph-trust";
import {
  loadedNodeRelationTrustInclude,
  PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT,
  projectPublicNodeRelationTrustAssessments,
  type LoadedNodeRelationTrustAssessment,
} from "./trust-provenance";

/** The persisted, fail-closed TRUST source used by anonymous graph reads. */
export const databaseGraphTrustProvider: GraphTrustProvider = {
  async lookup(keys) {
    const exactKeys = new Map(keys.map((key) => [graphTrustLookupKey(key), key]));
    if (exactKeys.size === 0) return new Map();

    const rows = await prisma.nodeRelationTrustAssessment.findMany({
      where: {
        OR: [...exactKeys.values()].map((key) => ({
          proposal: {
            sourceNodeVersionId: key.sourceVersionId,
            targetNodeVersionId: key.targetVersionId,
            relationType: key.relationType,
          },
        })),
      },
      include: loadedNodeRelationTrustInclude,
      orderBy: [{ assessedAt: "desc" }, { id: "asc" }],
      take: PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT + 1,
    });
    if (rows.length > PUBLIC_NODE_RELATION_TRUST_GLOBAL_LIMIT) return new Map();

    return projectGraphTrustRows(exactKeys, rows as LoadedNodeRelationTrustAssessment[]);
  },
};

export function projectGraphTrustRows(
  exactKeys: ReadonlyMap<string, GraphTrustLookupKey>,
  rows: readonly LoadedNodeRelationTrustAssessment[],
): ReadonlyMap<string, unknown> {
  const groups = new Map<string, LoadedNodeRelationTrustAssessment[]>();
  for (const row of rows) {
    const relationType = nodeRelationTypeSchema.safeParse(row.proposal.relationType);
    if (!relationType.success) continue;
    const key = graphTrustLookupKey({
      sourceVersionId: row.proposal.sourceNodeVersionId,
      targetVersionId: row.proposal.targetNodeVersionId,
      relationType: relationType.data,
    });
    if (!exactKeys.has(key)) continue;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  const result = new Map<string, unknown>();
  for (const [key, group] of groups) {
    const assessments = projectPublicNodeRelationTrustAssessments(group);
    if (assessments.length === 0) continue;
    const parsed = publicGraphTrustSchema.array().safeParse(assessments);
    if (!parsed.success) continue;
    if (parsed.data.length === 1) {
      const assessment = parsed.data[0];
      if (!assessment) continue;
      const { protocolVersion, reviewStatus, verificationState } = assessment;
      result.set(key, { protocolVersion, reviewStatus, verificationState });
    } else {
      result.set(key, parsed.data);
    }
  }
  return result;
}
