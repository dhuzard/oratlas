import "server-only";
import { ARCHIVE_SYNTHESIS_CANDIDATE_SCAN_LIMIT, type PublicNodeSummary } from "@oratlas/contracts";
import type { PrismaClient } from "@oratlas/db";
import { prisma } from "./db";
import { listPublicNodeSummaries, PUBLIC_NODE_SEARCH_LIMIT } from "./node-publication";
import { getPublicSynthesisReview } from "./synthesis-editorial";

const SYNTHESIS_INTEGRITY_BATCH_SIZE = 25;

export const COVERAGE_TOPIC_STRATEGY =
  "Current public nodes are grouped by node kind and source repository; the node contract has no controlled topic taxonomy." as const;

export interface TopicCoverageGroup {
  key: string;
  label: string;
  kind: PublicNodeSummary["kind"];
  repository: PublicNodeSummary["repository"];
  nodes: PublicNodeSummary[];
}

export interface TopicCoverageSnapshot {
  scannedNodeCount: number;
  coveredNodeCount: number;
  uncoveredNodeCount: number;
  groups: TopicCoverageGroup[];
  topicStrategy: typeof COVERAGE_TOPIC_STRATEGY;
  bounds: {
    nodeLimit: typeof PUBLIC_NODE_SEARCH_LIMIT;
    nodeLimitReached: boolean;
    synthesisCandidateLimit: typeof ARCHIVE_SYNTHESIS_CANDIDATE_SCAN_LIMIT;
    synthesisCandidateLimitReached: boolean;
  };
}

/** Exact identity: a synthesis covering node N@v1 never covers N@v2. */
function nodeVersionKey(nodeId: string, nodeVersionId: string): string {
  return `${nodeId}\0${nodeVersionId}`;
}

export function buildTopicCoverageSnapshot(
  suppliedNodes: readonly PublicNodeSummary[],
  coveredNodeVersions: ReadonlySet<string>,
  synthesisCandidateLimitReached = false,
): TopicCoverageSnapshot {
  const nodes = suppliedNodes.slice(0, PUBLIC_NODE_SEARCH_LIMIT);
  const uncovered = nodes.filter(
    (node) => !coveredNodeVersions.has(nodeVersionKey(node.id, node.currentVersionId)),
  );
  const groups = new Map<string, TopicCoverageGroup>();
  for (const node of uncovered) {
    const repositoryKey = `${canonical(node.repository.owner)}/${canonical(node.repository.name)}`;
    const key = `${node.kind}:${repositoryKey}`;
    const existing = groups.get(key);
    if (existing) existing.nodes.push(node);
    else {
      groups.set(key, {
        key,
        label: `${kindLabel(node.kind)} · ${node.repository.owner}/${node.repository.name}`,
        kind: node.kind,
        repository: node.repository,
        nodes: [node],
      });
    }
  }
  const orderedGroups = [...groups.values()].sort(
    (left, right) => kindOrder(left.kind) - kindOrder(right.kind) || compare(left.key, right.key),
  );
  for (const group of orderedGroups) {
    group.nodes.sort(
      (left, right) => compare(left.title, right.title) || compare(left.id, right.id),
    );
  }
  return {
    scannedNodeCount: nodes.length,
    coveredNodeCount: nodes.length - uncovered.length,
    uncoveredNodeCount: uncovered.length,
    groups: orderedGroups,
    topicStrategy: COVERAGE_TOPIC_STRATEGY,
    bounds: {
      nodeLimit: PUBLIC_NODE_SEARCH_LIMIT,
      nodeLimitReached: suppliedNodes.length >= PUBLIC_NODE_SEARCH_LIMIT,
      synthesisCandidateLimit: ARCHIVE_SYNTHESIS_CANDIDATE_SCAN_LIMIT,
      synthesisCandidateLimitReached,
    },
  };
}

export async function getTopicCoverage(
  client: PrismaClient = prisma,
): Promise<TopicCoverageSnapshot> {
  const [nodes, candidates] = await Promise.all([
    listPublicNodeSummaries(undefined, client),
    client.review.findMany({
      where: {
        reviewType: "ai-synthesis",
        status: "published",
        currentSynthesisVersionId: { not: null },
      },
      select: {
        slug: true,
        currentSynthesisVersionId: true,
        currentSynthesisVersion: {
          select: {
            id: true,
            synthesisDraft: {
              select: {
                status: true,
                memberships: {
                  select: { nodeId: true, nodeVersionId: true },
                  orderBy: { position: "asc" },
                },
              },
            },
          },
        },
        versions: {
          where: {
            recordSourceType: "synthesis",
            publicState: "published",
            synthesisDraft: { is: { status: "accepted" } },
          },
          select: { id: true },
          orderBy: [{ synthesisOrdinal: "desc" }, { id: "desc" }],
          take: 1,
        },
      },
      orderBy: { slug: "asc" },
      take: ARCHIVE_SYNTHESIS_CANDIDATE_SCAN_LIMIT,
    }),
  ]);

  const covered = new Set<string>();
  for (let start = 0; start < candidates.length; start += SYNTHESIS_INTEGRITY_BATCH_SIZE) {
    const batch = candidates.slice(start, start + SYNTHESIS_INTEGRITY_BATCH_SIZE);
    const publicSyntheses = await Promise.all(
      batch.map((candidate) => getPublicSynthesisReview(candidate.slug, client)),
    );
    for (let index = 0; index < batch.length; index += 1) {
      const candidate = batch[index]!;
      const synthesis = publicSyntheses[index];
      const version = candidate.currentSynthesisVersion;
      const draft = version?.synthesisDraft;
      if (
        !synthesis ||
        synthesis.version.id !== candidate.currentSynthesisVersionId ||
        candidate.versions[0]?.id !== synthesis.version.id ||
        version?.id !== synthesis.version.id ||
        draft?.status !== "accepted"
      )
        continue;
      for (const membership of draft.memberships) {
        covered.add(nodeVersionKey(membership.nodeId, membership.nodeVersionId));
      }
    }
  }

  return buildTopicCoverageSnapshot(
    nodes,
    covered,
    candidates.length === ARCHIVE_SYNTHESIS_CANDIDATE_SCAN_LIMIT,
  );
}

function kindLabel(kind: PublicNodeSummary["kind"]): string {
  switch (kind) {
    case "claim":
      return "Claims";
    case "figure":
      return "Figures";
    case "dataset":
      return "Datasets";
    case "code":
      return "Code";
  }
}

function kindOrder(kind: PublicNodeSummary["kind"]): number {
  return ["claim", "figure", "dataset", "code"].indexOf(kind);
}

function canonical(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

function compare(left: string, right: string): number {
  const a = canonical(left);
  const b = canonical(right);
  return a < b ? -1 : a > b ? 1 : left < right ? -1 : left > right ? 1 : 0;
}
