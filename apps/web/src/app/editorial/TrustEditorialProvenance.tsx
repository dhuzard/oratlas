import { type TrustQueueItem } from "@/lib/trust-provenance";

/**
 * Visible, presentation-safe provenance for one exact assessment. JSON source
 * records stay private to the data boundary; editors see presence and stored
 * assertions without an ambiguous "best assessment" summary.
 */
export function TrustEditorialProvenance({ item }: { item: TrustQueueItem }) {
  const relationAssertion =
    item.subjectType === "node-relation"
      ? "not applicable to node-relation records"
      : item.sourceRelationHumanReviewed === true
        ? "repository labelled relation human-reviewed"
        : item.sourceRelationHumanReviewed === false
          ? "repository did not label relation human-reviewed"
          : "not supplied";

  return (
    <section
      aria-label={`${item.subjectType === "node-relation" ? "Node-relation" : "Claim-citation"} TRUST assessment ${item.assessmentId}`}
    >
      <h3>
        {item.subjectType === "node-relation" ? "Node-relation" : "Claim–citation"} assessment
      </h3>
      <p className="mono muted" style={{ fontSize: "0.8rem" }}>
        Assessment ID {item.assessmentId}
      </p>
      <div className="table-scroll">
        <table className="data">
          <caption className="sr-only">Stored assessor, protocol, and source provenance</caption>
          <thead>
            <tr>
              <th scope="col">Provenance field</th>
              <th scope="col">Assessment record</th>
              <th scope="col">Repository source assertion</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Assessor type</th>
              <td>{item.assessorType}</td>
              <td>{item.sourceAssessorType ?? "not supplied"}</td>
            </tr>
            <tr>
              <th scope="row">Assessor ID</th>
              <td className="mono">{item.assessorId ?? "not supplied"}</td>
              <td className="mono">{item.sourceAssessorId ?? "not supplied"}</td>
            </tr>
            <tr>
              <th scope="row">Assessed at</th>
              <td>{dateValue(item.assessedAt)}</td>
              <td>{dateValue(item.sourceAssessedAt)}</td>
            </tr>
            <tr>
              <th scope="row">Evidence pointer</th>
              <td>{item.evidenceAvailable ? "supplied" : "not supplied"}</td>
              <td>{item.sourceEvidenceAvailable ? "supplied" : "not supplied"}</td>
            </tr>
            <tr>
              <th scope="row">Review status</th>
              <td>{item.effectiveStatus.replaceAll("-", " ")}</td>
              <td>{item.sourceReviewStatus ?? "not supplied"}</td>
            </tr>
            <tr>
              <th scope="row">Aggregate</th>
              <td>{aggregateValue(item, "computed")}</td>
              <td>{aggregateValue(item, "source")}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <dl className="def-list">
        <div>
          <dt>Protocol identifier</dt>
          <dd>TRUST</dd>
        </div>
        <div>
          <dt>Protocol version</dt>
          <dd className="mono">{item.protocolVersion}</dd>
        </div>
        <div>
          <dt>Repository source record</dt>
          <dd>{item.sourceRecordAvailable ? "supplied" : "not supplied"}</dd>
        </div>
        <div>
          <dt>Repository relation assertion</dt>
          <dd>{relationAssertion}</dd>
        </div>
        <div>
          <dt>Atlas marker reviewer</dt>
          <dd className="mono">{item.reviewerLogin ?? "not reviewed"}</dd>
        </div>
      </dl>
      <p className="muted" style={{ fontSize: "0.85rem" }}>
        Stored identifiers are displayed as supplied. Atlas does not resolve, rate, or match
        assessors, and this record is not scientific verification.
      </p>
    </section>
  );
}

function dateValue(value: string | undefined) {
  return value ? <time dateTime={value}>{value}</time> : "not supplied";
}

function aggregateValue(item: TrustQueueItem, provenance: "computed" | "source") {
  if (item.subjectType === "node-relation") return "omitted for relation TRUST";
  const value = provenance === "computed" ? item.computedAggregateScore : item.sourceAggregateScore;
  return value ?? (provenance === "computed" ? "not computable" : "null / not supplied");
}
