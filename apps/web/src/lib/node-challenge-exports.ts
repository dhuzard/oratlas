import "server-only";
import type { NodeChallengeExportInput } from "@oratlas/exports";
import { appBaseUrl } from "./base-url";
import { listNodeChallenges } from "./challenges";

export async function loadNodeChallengeExport(
  nodeId: string,
  cursor?: string,
  limit?: number,
): Promise<NodeChallengeExportInput | null> {
  const register = await listNodeChallenges(nodeId, cursor, limit);
  if (!register) return null;
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (limit !== undefined) query.set("limit", String(limit));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return {
    nodeId,
    canonicalNodeUrl: `${appBaseUrl()}/nodes/${encodeURIComponent(nodeId)}`,
    challengeJsonUrl: `${appBaseUrl()}/api/nodes/${encodeURIComponent(nodeId)}/exports/challenges.json${suffix}`,
    challenges: register.challenges,
    nextCursor: register.nextCursor,
  };
}
