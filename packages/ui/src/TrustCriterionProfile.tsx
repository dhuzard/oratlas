import { type ReactNode } from "react";

export interface TrustCriterionProfileRow {
  criterion: string;
  rating: string;
  status: string;
  rationale?: string;
}

export function TrustCriterionProfile({
  criteria,
  label = "TRUST criteria",
}: {
  criteria: readonly TrustCriterionProfileRow[];
  label?: string;
}) {
  return (
    <div className="trust-grid" role="table" aria-label={label}>
      <div className="trust-criterion" role="row" style={{ fontWeight: 600 }}>
        <span role="columnheader">Criterion</span>
        <span role="columnheader">Rating</span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Rationale</span>
      </div>
      {criteria.map((criterion) => (
        <div className="trust-criterion" role="row" key={criterion.criterion}>
          <span role="cell">{humanizeTrustCriterion(criterion.criterion)}</span>
          <span role="cell" className={ratingClassName(criterion.rating)}>
            {humanizeValue(criterion.rating)}
          </span>
          <span role="cell">{humanizeValue(criterion.status)}</span>
          <span role="cell" className="muted">
            {criterion.rationale ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

export function humanizeTrustCriterion(value: string): string {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

function humanizeValue(value: string): ReactNode {
  return value.replaceAll("-", " ");
}

function ratingClassName(rating: string): string | undefined {
  return ["very-low", "low", "moderate", "high", "very-high"].includes(rating)
    ? `ordinal ordinal-${rating}`
    : undefined;
}
