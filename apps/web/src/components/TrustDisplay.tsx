import { TrustCriterionProfile } from "@oratlas/ui";
import { type ReviewTrust } from "@/lib/reviews";
import { TrustVerificationBadge } from "./TrustVerificationBadge";

/**
 * Renders a TRUST assessment for a claim–citation relation. Never shows an
 * aggregate without the criterion detail and the aggregate method (spec §11).
 * Clearly separates repository assertions from Atlas verification.
 */
export function TrustDisplay({ trust }: { trust: ReviewTrust }) {
  const platformVerified = trust.verificationState === "platform-verified";
  return (
    <div className="trust-block">
      <div className="btn-row" style={{ marginBottom: "0.4rem" }}>
        <TrustVerificationBadge state={trust.verificationState} />
        <span className="muted">protocol {trust.protocolVersion}</span>
        <span className="muted">
          assessor {trust.assessorId ?? trust.sourceAssertion.assessorId ?? trust.assessorType}
        </span>
      </div>

      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Repository assertion: status {trust.sourceAssertion.reviewStatus ?? "not supplied"};
        assessor type {trust.sourceAssertion.assessorType ?? trust.assessorType}
        {trust.sourceAssertion.assessorId ? ` (${trust.sourceAssertion.assessorId})` : ""}
        {trust.sourceAssertion.relationHumanReviewed === true
          ? "; relation was labelled human-reviewed by the repository"
          : ""}
        . Repository labels are preserved as provenance and do not become Atlas verification.
      </p>

      {trust.supersedesAssessmentId ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Source revision of assessment <span className="mono">{trust.supersedesAssessmentId}</span>
          ; both records remain visible.
        </p>
      ) : null}

      {platformVerified && trust.platformVerification ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Atlas marker recorded by @{trust.platformVerification.reviewerLogin}.
        </p>
      ) : trust.verificationState === "stale-verification" ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          The reviewed content changed after an Atlas marker was recorded, so the marker no longer
          applies.
        </p>
      ) : null}

      <TrustCriterionProfile criteria={trust.criteria} />

      {trust.limitations.length > 0 ? (
        <div>
          <strong style={{ fontSize: "0.9rem" }}>Limitations</strong>
          <ul>
            {trust.limitations.map((l, i) => (
              <li key={i} className="muted">
                {l}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {trust.aggregateScore !== undefined &&
      trust.aggregateScore !== null &&
      trust.aggregateMethod ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Atlas-computed aggregate: <strong>{trust.aggregateScore.toFixed(2)}</strong> via{" "}
          <span className="mono">{trust.aggregateMethod}</span> — advisory only; the criterion
          ratings above are authoritative. This is not the probability that the paper is true.
        </p>
      ) : null}
      {trust.sourceAssertion.aggregateScore !== null && trust.sourceAssertion.aggregateMethod ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Repository-supplied source aggregate:{" "}
          <strong>{trust.sourceAssertion.aggregateScore.toFixed(2)}</strong> via{" "}
          <span className="mono">{trust.sourceAssertion.aggregateMethod}</span>. This value is
          preserved for provenance; Atlas did not compute or verify it, and it is not a probability.
        </p>
      ) : trust.sourceAssertion.aggregateScore !== null ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          The repository supplied an aggregate without an aggregation method, so the value is
          withheld. Criterion-level assertions remain available above.
        </p>
      ) : null}
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Atlas review of this record concerns provenance and structural consistency. It is not peer
        review and does not establish scientific correctness.
      </p>
    </div>
  );
}
