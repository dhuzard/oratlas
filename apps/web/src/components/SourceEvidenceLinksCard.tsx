import { Badge, Card, Notice } from "@oratlas/ui";
import { type SourceEvidenceLinks } from "@oratlas/contracts";

/**
 * Claim-scoped producer-finding lineage declared by the review repository's source-native sidecar.
 * Everything shown is the producer's declaration as preserved; ORAtlas has not imported or verified
 * the external packet, and the native assessment is never presented as an ORAtlas assessment.
 */
export function SourceEvidenceLinksCard({ links }: { links: SourceEvidenceLinks }) {
  // A review that declares no sidecar has nothing to show; the passport API still states why.
  if (links.status === "sidecar-unavailable") return null;
  return (
    <div id="source-evidence" className="inspection-anchor">
      <Card title="Producer findings (external evidence packet)">
        <p className="muted">{links.labels.producer}</p>
        {links.status === "sidecar-invalid" ? (
          <Notice tone="warning" title="Sidecar unreadable">
            The declared sidecar could not be read as a source-native sidecar. No lineage is shown.
          </Notice>
        ) : null}
        {links.status === "sidecar-stale" ? (
          <Notice tone="warning" title="Sidecar does not match this version">
            The sidecar was exported for different claim text or a different claim graph than this
            version preserves. Its lineage and native assessment are withheld.
          </Notice>
        ) : null}
        {links.status === "no-producer-finding" ? (
          <p className="muted">
            The sidecar was read and no producer finding is linked to this claim.
          </p>
        ) : null}
        {links.citations.map((citation) => (
          <div className="claim-card" key={citation.citationLocalId}>
            <div className="btn-row">
              <Badge tone="neutral">{citation.relation.relationType.replace(/-/g, " ")}</Badge>
              <strong>{citation.citationLocalId}</strong>
              {citation.doi ? (
                citation.doiIsExample ? (
                  <span className="mono">{citation.doi} (example)</span>
                ) : (
                  <a className="mono" href={`https://doi.org/${citation.doi}`}>
                    {citation.doi}
                  </a>
                )
              ) : null}
            </div>
            <ul>
              {citation.findings.map((finding) => (
                <li key={finding.findingId}>
                  <span className="mono">{finding.findingId}</span>{" "}
                  <Badge tone="neutral">producer: {finding.producer}</Badge>
                  <div className="mono muted" style={{ fontSize: "0.8rem" }}>
                    packet {finding.packetId} · source snapshot SHA-256{" "}
                    {finding.sourceSnapshotSha256}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {links.packets.map((packet) => (
          <p className="mono muted" key={packet.packetId} style={{ fontSize: "0.8rem" }}>
            packet {packet.packetId} · SHA-256 {packet.packetSha256} · location not declared
          </p>
        ))}
        {links.citations.length > 0 ? (
          <>
            <p className="muted">{links.labels.packet}</p>
            <p className="muted">{links.labels.passage}</p>
          </>
        ) : null}
        {links.rejected.length > 0 ? (
          <Notice tone="warning" title="Links not shown">
            <ul>
              {links.rejected.map((link) => (
                <li key={`${link.findingId}:${link.citeKey}:${link.reason}`}>
                  <span className="mono">{link.findingId ?? "unreadable record"}</span> —{" "}
                  {link.reason}
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {links.nativeAssessment ? (
          <div className="claim-card">
            <div className="btn-row">
              <Badge tone="neutral">source-native</Badge>
              <span>
                Computational Review TRUST v{links.nativeAssessment.rubricVersion}:{" "}
                {links.nativeAssessment.label}
                {links.nativeAssessment.nativeOverallScore !== null
                  ? ` (native ${links.nativeAssessment.nativeOverallScore}/100)`
                  : ""}
              </span>
            </div>
            <p className="muted">{links.labels.nativeAssessment}</p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
