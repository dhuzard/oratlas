import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TRUST_CRITERIA } from "@oratlas/contracts";
import { type TrustQueueItem } from "@/lib/trust-provenance";
import { TrustEditorialProvenance } from "./TrustEditorialProvenance";

function item(overrides: Partial<TrustQueueItem> = {}): TrustQueueItem {
  return {
    assessmentId: "assessment-1",
    subjectType: "claim-citation",
    subjectHref: "/reviews/example",
    subjectLabel: "example",
    canVerify: true,
    claimLocalId: "claim-1",
    claimText: "A claim",
    citationLocalId: "citation-1",
    relationType: "supports",
    protocolVersion: "trust-poc-1.0",
    assessorType: "agent",
    assessorId: "primary-agent",
    assessedAt: "2026-01-02T03:04:05.000Z",
    evidenceAvailable: true,
    sourceRecordAvailable: true,
    sourceReviewStatus: "agent-proposed",
    sourceAssessorType: "agent",
    sourceAssessorId: "source-agent",
    sourceAssessedAt: "2026-01-01T03:04:05.000Z",
    sourceEvidenceAvailable: true,
    sourceRelationHumanReviewed: false,
    criteria: TRUST_CRITERIA.map((criterion) => ({
      criterion,
      rating: "not-supplied",
      status: "not-supplied",
    })),
    sourceAggregateScore: 0.37,
    computedAggregateScore: 0.61,
    effectiveStatus: "unverified-import",
    verificationState: "unverified-import",
    revision: 0,
    assessmentHash: "a".repeat(64),
    ...overrides,
  };
}

describe("TrustEditorialProvenance", () => {
  it("renders exact claim-citation provenance without source JSON", () => {
    const html = renderToStaticMarkup(<TrustEditorialProvenance item={item()} />);

    expect(html).toContain("Claim–citation assessment");
    expect(html).toContain("primary-agent");
    expect(html).toContain("source-agent");
    expect(html).toContain("trust-poc-1.0");
    expect(html).toContain("repository did not label relation human-reviewed");
    expect(html).not.toContain("sourceRecordJson");
    expect(html).not.toContain("Aggregate");
    expect(html).not.toContain("0.37");
    expect(html).not.toContain("0.61");
  });

  it("labels node-relation provenance distinctly without inventing a relation assertion", () => {
    const html = renderToStaticMarkup(
      <TrustEditorialProvenance item={item({ subjectType: "node-relation" })} />,
    );

    expect(html).toContain("Node-relation assessment");
    expect(html).toContain("not applicable to node-relation records");
    expect(html).not.toContain("Aggregate");
  });
});
