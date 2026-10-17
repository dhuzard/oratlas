import { Badge, Card, Notice } from "@oratlas/ui";
import { type SourceEvidenceLinkedFinding, type SourceEvidenceLinks } from "@oratlas/contracts";

const small = { fontSize: "0.8rem" } as const;

function FindingItem({ finding }: { finding: SourceEvidenceLinkedFinding }) {
  return (
    <li>
      <span className="mono">{finding.findingId}</span>{" "}
      <Badge tone="neutral">producer: {finding.producer}</Badge>
      {finding.revision !== null ? (
        <span className="muted">
          {" "}
          revision {finding.revision}
          {finding.verificationLevel ? ` · packet level ${finding.verificationLevel}` : ""}
        </span>
      ) : null}
      {finding.mapping ? (
        <div className="muted" style={small}>
          Mapped to this claim by decision{" "}
          <span className="mono">{finding.mapping.decisionRef}</span> (
          {finding.mapping.assertedAt.slice(0, 10)}): {finding.mapping.basis}
        </div>
      ) : null}
      <div className="mono muted" style={small}>
        packet {finding.packetId} · source snapshot SHA-256 {finding.sourceSnapshotSha256}
      </div>
      {finding.passages ? (
        <ul>
          {finding.passages.map((passage) => (
            <li key={passage.passageId} className="mono muted" style={small}>
              passage {passage.passageId} · quote {passage.quoteSha256} ·{" "}
              {passage.quoteState === "withheld-rights" ? "quote withheld" : "quote in packet"} ·
              match {passage.matchStatus}
            </li>
          ))}
        </ul>
      ) : (
        <div className="muted" style={small}>
          No passage data in the sidecar.
        </div>
      )}
      {finding.assessments && finding.assessments.length > 0 ? (
        <div className="muted" style={small}>
          Native Diggypaper judgments ({finding.assessments[0]!.protocol}):{" "}
          {finding.assessments
            .map((assessment) => `${assessment.assessmentId} ${assessment.status}`)
            .join("; ")}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Claim-scoped producer-finding lineage declared by the review repository's source-native sidecar.
 * Everything shown is the producer's declaration as preserved; ORAtlas has not imported or verified
 * the external packet, and the native assessment is never presented as an ORAtlas assessment. Only
 * reviewed mappings are shown as this claim's evidence; same-paper candidates are listed apart.
 */
export function SourceEvidenceLinksCard({ links }: { links: SourceEvidenceLinks }) {
  // A review that declares no sidecar has nothing to show; the passport API still states why.
  if (links.status === "sidecar-unavailable") return null;
  const native = links.nativeAssessment;
  return (
    <div id="source-evidence" className="inspection-anchor">
      <Card title="Producer findings (external evidence packet)">
        <p className="muted">{links.labels.producer}</p>
        {links.status === "sidecar-invalid" ? (
          <Notice tone="warning" title="Sidecar unreadable">
            The declared sidecar is malformed or holds conflicting records for this claim. No
            lineage is shown.
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
        {links.status === "candidates-only" ? (
          <p className="muted">
            No finding is mapped to this claim by a reviewed decision. Only same-paper candidates
            are listed.
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
            {citation.findings.length > 0 ? (
              <ul>
                {citation.findings.map((finding) => (
                  <FindingItem key={finding.findingId} finding={finding} />
                ))}
              </ul>
            ) : null}
            {citation.candidateFindings.length > 0 ? (
              <details>
                <summary className="muted">
                  Same-paper candidates, not evidence for this claim (
                  {citation.candidateFindings.length})
                </summary>
                <p className="muted" style={small}>
                  {links.labels.candidate}
                </p>
                <ul>
                  {citation.candidateFindings.map((finding) => (
                    <FindingItem key={finding.findingId} finding={finding} />
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ))}
        {links.packets.map((packet) => (
          <p className="mono muted" key={packet.packetId} style={small}>
            packet {packet.packetId} · SHA-256 {packet.packetSha256} ·{" "}
            {packet.locator ? (
              <>
                declared location:{" "}
                {packet.locator.href ? (
                  <a href={packet.locator.href} rel="noopener noreferrer">
                    {packet.locator.doi ?? packet.locator.url}
                  </a>
                ) : (
                  <span>{packet.locator.doi} (example, not linked)</span>
                )}
              </>
            ) : (
              "location not declared"
            )}
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
        {native ? (
          <details className="claim-card">
            <summary>
              <Badge tone="neutral">source-native</Badge> Computational Review TRUST v
              {native.rubricVersion}
              {native.verifiedAgainstPreservedSources ? "" : " (unverified source declaration)"}
            </summary>
            <p>
              {native.label}
              {native.nativeOverallScore !== null
                ? ` (native ${native.nativeOverallScore}/100)`
                : ""}
            </p>
            <p className="muted">{links.labels.nativeAssessment}</p>
            {native.verifiedAgainstPreservedSources ? (
              <p className="muted" style={small}>
                Recorded digests of the review&apos;s claim graph and TRUST report match the bytes
                preserved with this version.
              </p>
            ) : (
              <p className="muted" style={small}>
                {links.labels.nativeAssessmentUnverified}
              </p>
            )}
          </details>
        ) : null}
        {links.nativeAssessmentWithheld === "trust-report-digest-mismatch" ? (
          <Notice tone="warning" title="Native assessment withheld">
            The review&apos;s preserved TRUST report does not match the digest the sidecar records.
          </Notice>
        ) : null}
      </Card>
    </div>
  );
}
