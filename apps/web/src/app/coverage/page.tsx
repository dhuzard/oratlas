import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, Notice } from "@oratlas/ui";
import { getTopicCoverage } from "@/lib/synthesis-coverage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Topic coverage" };

export default async function CoveragePage() {
  const coverage = await getTopicCoverage();
  return (
    <>
      <h1>Topic coverage</h1>
      <p className="muted">
        {coverage.uncoveredNodeCount} of {coverage.scannedNodeCount} current public node version
        {coverage.scannedNodeCount === 1 ? "" : "s"} are not covered by a valid current accepted
        synthesis. Coverage is exact-version evidence, not a quality or truth score.
      </p>
      <p className="muted">{coverage.topicStrategy}</p>

      {coverage.bounds.nodeLimitReached || coverage.bounds.synthesisCandidateLimitReached ? (
        <Notice tone="warning" title="Bounded proof-of-concept view">
          This request reached{" "}
          {coverage.bounds.nodeLimitReached
            ? `the ${coverage.bounds.nodeLimit}-candidate node scan ceiling ` +
              `(${coverage.bounds.scannedNodeCandidateCount} stored candidates scanned; ` +
              `${coverage.scannedNodeCount} valid public heads included)`
            : `the ${coverage.bounds.synthesisCandidateLimit}-synthesis ceiling`}
          . Counts describe the bounded scan.
        </Notice>
      ) : null}

      {coverage.groups.length === 0 ? (
        <Card>
          <p>Every scanned current public node version is covered by an accepted synthesis.</p>
        </Card>
      ) : (
        coverage.groups.map((group) => (
          <section key={group.key} aria-labelledby={`coverage-${group.key}`}>
            <h2 id={`coverage-${group.key}`}>{group.label}</h2>
            <ul className="review-list">
              {group.nodes.map((node) => (
                <li className="review-item" key={`${node.id}:${node.currentVersionId}`}>
                  <Card as="article">
                    <h3 style={{ margin: "0 0 0.3rem" }}>
                      <Link href={`/nodes/${node.id}/versions/${node.currentVersionId}`}>
                        {node.title}
                      </Link>
                    </h3>
                    <div className="meta">
                      <Badge>{node.kind}</Badge>
                      <Badge>uncovered current version</Badge>
                    </div>
                    {node.abstract ? <p>{node.abstract}</p> : null}
                    <p className="muted">
                      {node.repository.owner}/{node.repository.name} ·{" "}
                      <span className="mono">{node.localNodeId}</span>
                    </p>
                    <p>
                      <Link
                        href={`/editorial?synthesisSeedNodeId=${encodeURIComponent(node.id)}#synthesis-drafts`}
                      >
                        Start an editor-gated synthesis from this node →
                      </Link>
                    </p>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
