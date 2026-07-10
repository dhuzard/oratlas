import { type ReactNode } from "react";

/**
 * The visual system distinguishes the five kinds of information the platform
 * handles (spec §18). Each maps to a labelled, colour- AND text-coded badge so
 * the distinction never relies on colour alone (accessibility).
 */
export type ProvenanceKind =
  | "repository-fact"
  | "extracted"
  | "curated"
  | "agent-proposed"
  | "human-reviewed"
  | "warning"
  | "error";

const KIND_META: Record<ProvenanceKind, { label: string; className: string; icon: string }> = {
  "repository-fact": { label: "Repository fact", className: "prov-repo", icon: "◆" },
  extracted: { label: "Extracted", className: "prov-extracted", icon: "⁂" },
  curated: { label: "Human-curated", className: "prov-curated", icon: "✎" },
  "agent-proposed": { label: "Agent-proposed", className: "prov-agent", icon: "◈" },
  "human-reviewed": { label: "Human-reviewed", className: "prov-human", icon: "✓" },
  warning: { label: "Warning", className: "prov-warning", icon: "!" },
  error: { label: "Error", className: "prov-error", icon: "✕" },
};

export function ProvenanceBadge({
  kind,
  children,
}: {
  kind: ProvenanceKind;
  children?: ReactNode;
}) {
  const meta = KIND_META[kind];
  return (
    <span className={`prov-badge ${meta.className}`} data-prov={kind}>
      <span aria-hidden="true" className="prov-icon">
        {meta.icon}
      </span>
      <span>{children ?? meta.label}</span>
    </span>
  );
}

/** A labelled field showing its extracted value, source, and any manual edit. */
export function ProvenanceField({
  label,
  value,
  source,
  edited,
  confidence,
}: {
  label: string;
  value: ReactNode;
  source?: string;
  edited?: boolean;
  confidence?: number;
}) {
  return (
    <div className="prov-field">
      <div className="prov-field-label">{label}</div>
      <div className="prov-field-value">{value || <span className="muted">—</span>}</div>
      <div className="prov-field-meta">
        {edited ? (
          <ProvenanceBadge kind="curated">Edited</ProvenanceBadge>
        ) : source ? (
          <ProvenanceBadge kind="extracted">{`from ${source}`}</ProvenanceBadge>
        ) : null}
        {confidence !== undefined ? (
          <span className="muted"> confidence {Math.round(confidence * 100)}%</span>
        ) : null}
      </div>
    </div>
  );
}
