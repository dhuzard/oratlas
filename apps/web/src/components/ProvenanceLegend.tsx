import { ProvenanceBadge } from "@oratlas/ui";

/** Explains the five information kinds so the distinction is always available. */
export function ProvenanceLegend() {
  return (
    <div className="prov-legend" aria-label="Provenance legend">
      <ProvenanceBadge kind="repository-fact" />
      <ProvenanceBadge kind="extracted" />
      <ProvenanceBadge kind="curated" />
      <ProvenanceBadge kind="agent-proposed" />
      <ProvenanceBadge kind="human-reviewed" />
    </div>
  );
}
