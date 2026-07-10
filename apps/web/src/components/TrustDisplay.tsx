import { ProvenanceBadge } from "@oratlas/ui";
import { type ReviewTrust } from "@/lib/reviews";

/**
 * Renders a TRUST assessment for a claim–citation relation. Never shows an
 * aggregate without the criterion detail and the aggregate method (spec §11).
 * Clearly marks agent-proposed vs human-reviewed.
 */
export function TrustDisplay({ trust }: { trust: ReviewTrust }) {
  const isHuman = trust.reviewStatus === "human-reviewed" || trust.reviewStatus === "adjudicated";
  return (
    <div className="trust-block">
      <div className="btn-row" style={{ marginBottom: "0.4rem" }}>
        <ProvenanceBadge kind={isHuman ? "human-reviewed" : "agent-proposed"}>
          {trust.reviewStatus.replace(/-/g, " ")}
        </ProvenanceBadge>
        <span className="muted">assessor: {trust.assessorType}</span>
        <span className="muted">protocol {trust.protocolVersion}</span>
      </div>

      {trust.criteria.length === 0 ? (
        <p className="muted">No criterion-level assessments recorded.</p>
      ) : (
        <div className="trust-grid" role="table" aria-label="TRUST criteria">
          <div className="trust-criterion" role="row" style={{ fontWeight: 600 }}>
            <span role="columnheader">Criterion</span>
            <span role="columnheader">Rating</span>
            <span role="columnheader">Rationale</span>
          </div>
          {trust.criteria.map((c) => (
            <div className="trust-criterion" role="row" key={c.criterion}>
              <span role="cell">{humanizeCriterion(c.criterion)}</span>
              <span role="cell" className={`ordinal ordinal-${c.rating}`}>
                {c.status === "assessed"
                  ? c.rating.replace(/-/g, " ")
                  : c.status.replace(/-/g, " ")}
              </span>
              <span role="cell" className="muted">
                {c.rationale ?? "—"}
              </span>
            </div>
          ))}
        </div>
      )}

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

      {trust.aggregateScore !== undefined && trust.aggregateScore !== null ? (
        <p className="muted" style={{ fontSize: "0.85rem" }}>
          Aggregate: <strong>{trust.aggregateScore.toFixed(2)}</strong> via{" "}
          <span className="mono">{trust.aggregateMethod}</span> — advisory only; the criterion
          ratings above are authoritative. This is not the probability that the paper is true.
        </p>
      ) : null}
    </div>
  );
}

function humanizeCriterion(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
