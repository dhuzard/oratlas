import {
  canonicalJson,
  type SubgraphEvidencePacket,
  type SynthesisStalenessAffectedReference,
  type SynthesisStalenessReasonCode,
} from "@oratlas/contracts";

function withoutTrust(edge: SubgraphEvidencePacket["edges"][number]) {
  const { trust: _trust, trustAssessments: _trustAssessments, ...identity } = edge;
  return identity;
}

function assessmentSet(edge: SubgraphEvidencePacket["edges"][number]) {
  return edge.trustAssessments ?? (edge.trust ? [edge.trust] : []);
}

/** Pure policy comparison; persistence and proposal lifecycle stay in the application layer. */
export function compareSynthesisPackets(
  accepted: SubgraphEvidencePacket,
  evaluated: SubgraphEvidencePacket,
): {
  reasons: Set<SynthesisStalenessReasonCode>;
  affected: SynthesisStalenessAffectedReference[];
} {
  const reasons = new Set<SynthesisStalenessReasonCode>();
  const affected: SynthesisStalenessAffectedReference[] = [];
  const oldNodes = new Map(accepted.nodes.map((node) => [node.id, node]));
  const newNodes = new Map(evaluated.nodes.map((node) => [node.id, node]));
  for (const [id, node] of oldNodes) {
    const current = newNodes.get(id);
    if (!current) {
      reasons.add("membership-removed");
      affected.push({ kind: "node", id, change: "removed", previousVersionId: node.versionId });
    } else if (node.versionId !== current.versionId) {
      reasons.add("node-head-changed");
      affected.push({
        kind: "node",
        id,
        change: "changed",
        previousVersionId: node.versionId,
        currentVersionId: current.versionId,
      });
    }
  }
  for (const id of newNodes.keys()) {
    if (!oldNodes.has(id)) {
      reasons.add("membership-added");
      affected.push({
        kind: "node",
        id,
        change: "added",
        currentVersionId: newNodes.get(id)!.versionId,
      });
    }
  }

  const oldEdges = new Map(accepted.edges.map((edge) => [edge.id, edge]));
  const newEdges = new Map(evaluated.edges.map((edge) => [edge.id, edge]));
  for (const [id, edge] of oldEdges) {
    const current = newEdges.get(id);
    if (!current) {
      reasons.add("confirmed-edge-removed");
      affected.push({ kind: "edge", id, change: "removed" });
      continue;
    }
    if (canonicalJson(withoutTrust(edge)) !== canonicalJson(withoutTrust(current))) {
      reasons.add("confirmed-edge-changed");
      affected.push({ kind: "edge", id, change: "changed" });
    }
    if (canonicalJson(assessmentSet(edge)) !== canonicalJson(assessmentSet(current))) {
      reasons.add("trust-changed");
      affected.push({ kind: "trust", id, change: "changed" });
    }
  }
  for (const id of newEdges.keys()) {
    if (!oldEdges.has(id)) {
      reasons.add("confirmed-edge-added");
      affected.push({ kind: "edge", id, change: "added" });
    }
  }
  return { reasons, affected };
}
