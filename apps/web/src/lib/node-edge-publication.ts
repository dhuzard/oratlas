import "server-only";
import { type Prisma } from "@oratlas/db";

/**
 * One authoritative public-edge predicate shared by KG-07's edge endpoint and
 * KG-05's node detail projection. A status string alone is never sufficient:
 * publication requires an editorial confirmation, timestamp, immutable target
 * version, and a confirmer who still has an editorial role.
 */
export const publicConfirmedNodeEdgeWhere = {
  status: "confirmed",
  provenance: "confirmed-by-editor",
  confirmedTargetNodeVersionId: { not: null },
  confirmedById: { not: null },
  confirmedAt: { not: null },
  confirmedBy: { is: { role: { in: ["EDITOR", "ADMIN"] } } },
} satisfies Prisma.NodeEdgeWhereInput;

/** Fail closed when the immutable target version does not belong to the stable target identity. */
export function hasOwnedConfirmedTargetVersion<
  T extends {
    targetNodeId: string;
    confirmedTargetNodeVersion: { knowledgeNodeId: string } | null;
  },
>(edge: T): edge is T & { confirmedTargetNodeVersion: { knowledgeNodeId: string } } {
  return edge.confirmedTargetNodeVersion?.knowledgeNodeId === edge.targetNodeId;
}
