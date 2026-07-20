import type { StoredCompatibilityReport } from "@/lib/compatibility-report";
import {
  presentArtifactOutcomes,
  type ArtifactKind,
  type ArtifactOutcomePresentation,
} from "@/lib/artifact-outcomes";

const LABELS: Record<ArtifactKind, string> = {
  claims: "Claims",
  citations: "Citations",
  relations: "Relations",
  trust: "TRUST assessments",
  nodes: "Knowledge nodes",
  edges: "Node edges",
};

export function ArtifactOutcomes({
  report,
  only,
}: {
  report?: StoredCompatibilityReport;
  only?: readonly ArtifactKind[];
}) {
  const rows = presentArtifactOutcomes(report, only);
  return (
    <dl className="definition-list artifact-outcomes">
      {rows.map((row) => (
        <div key={row.artifact}>
          <dt>{LABELS[row.artifact]}</dt>
          <dd>
            <span>{row.label}</span>
            {row.detail ? <span className="muted"> · {row.detail}</span> : null}
            <ArtifactReasons row={row} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ArtifactReasons({ row }: { row: ArtifactOutcomePresentation }) {
  return row.reasons.length > 0 ? (
    <ul>
      {row.reasons.map((reason, index) => (
        <li className="muted" key={`${row.artifact}:${index}`}>
          {reason}
        </li>
      ))}
    </ul>
  ) : null;
}
