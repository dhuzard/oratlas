import { redirect } from "next/navigation";
import { type Metadata } from "next";
import { Card, Notice, StatusPill, ProvenanceBadge } from "@oratlas/ui";
import { getCurrentUser, isEditor } from "@/lib/auth";
import { listAuditEvents, listSubmissions } from "@/lib/editorial";
import { listTrustEditorialQueue, type TrustQueueFilter } from "@/lib/trust-provenance";
import { DecisionForm } from "./DecisionForm";
import { TrustVerificationForm } from "./TrustVerificationForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editorial dashboard" };

export default async function EditorialPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!isEditor(user)) {
    return (
      <Notice tone="error" title="Editor access required">
        Your account ({user.githubLogin}) does not have the editor role.
      </Notice>
    );
  }

  const pending = await listSubmissions([
    "pending-editorial-review",
    "submitted",
    "automated-checks-failed",
    "changes-requested",
  ]);
  const decided = await listSubmissions(["accepted", "rejected"]);
  const audit = await listAuditEvents(30);
  const params = (await searchParams) ?? {};
  const requestedTrustFilter = Array.isArray(params.trustFilter)
    ? params.trustFilter[0]
    : params.trustFilter;
  const trustFilter: TrustQueueFilter = [
    "all",
    "needs-review",
    "stale",
    "legacy",
    "verified",
  ].includes(requestedTrustFilter ?? "")
    ? (requestedTrustFilter as TrustQueueFilter)
    : "needs-review";
  const trustQueue = await listTrustEditorialQueue(trustFilter);

  return (
    <div>
      <h1>Editorial dashboard</h1>
      <p className="muted">
        Editorial acceptance is distinct from submission and is not peer review. Accepting a
        submission materializes an immutable public review version from the exact submitted
        snapshot.
      </p>

      <h2>Pending submissions ({pending.length})</h2>
      {pending.length === 0 ? (
        <Card>
          <p className="muted">No pending submissions.</p>
        </Card>
      ) : (
        pending.map((s) => (
          <Card as="article" key={s.id}>
            <div className="btn-row" style={{ marginBottom: "0.4rem" }}>
              <StatusPill status={s.status} />
              <a href={s.repository.canonicalUrl} className="mono">
                {s.repository.owner}/{s.repository.name}
              </a>
              <span className="muted">by {s.submitterLogin}</span>
            </div>
            <p className="mono muted" style={{ fontSize: "0.85rem" }}>
              commit {s.commitSha ?? "—"}
            </p>

            {s.validation ? (
              <div>
                {s.validation.hardErrors.length > 0 ? (
                  <Notice tone="error" title="Automated checks failed">
                    <ul>
                      {s.validation.hardErrors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </Notice>
                ) : (
                  <p className="muted">
                    Compatibility: {s.validation.compatibilityLevel} · Completeness{" "}
                    {Math.round(s.validation.metadataCompleteness.score * 100)}% · Evidence{" "}
                    {s.validation.evidenceDataAvailable ? "yes" : "no"} · TRUST{" "}
                    {s.validation.trustDataAvailable ? "yes" : "no"}
                  </p>
                )}
                {s.validation.warnings.length > 0 ? (
                  <details>
                    <summary>{s.validation.warnings.length} warning(s)</summary>
                    <ul>
                      {s.validation.warnings.map((w, i) => (
                        <li key={i} className="muted">
                          {w}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            ) : null}

            <details>
              <summary>
                Metadata & submitted snapshot{" "}
                {s.metadataDiff.some((d) => d.changed) ? (
                  <ProvenanceBadge kind="curated">edited fields</ProvenanceBadge>
                ) : null}
              </summary>
              <div className="table-scroll">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Field</th>
                      <th>Extracted</th>
                      <th>Submitted (edited)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.metadataDiff.map((d) => (
                      <tr key={d.field}>
                        <td>{d.field}</td>
                        <td className="muted">{d.extracted || "—"}</td>
                        <td>{d.changed ? d.edited : <span className="muted">unchanged</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <DecisionForm submissionId={s.id} />
          </Card>
        ))
      )}

      <h2>TRUST provenance queue ({trustQueue.length})</h2>
      <p className="muted">
        Repository-supplied review labels are assertions only. Recording a platform marker confirms
        that an editor checked the captured structure and provenance; it is not scientific peer
        review and does not certify that a claim is correct.
      </p>
      <form method="get" className="filters" style={{ marginBottom: "1rem" }}>
        <div className="field">
          <label htmlFor="trustFilter">Queue state</label>
          <select id="trustFilter" name="trustFilter" defaultValue={trustFilter}>
            <option value="needs-review">Needs review</option>
            <option value="stale">Stale marker</option>
            <option value="legacy">Legacy/unknown provenance</option>
            <option value="verified">Platform reviewed</option>
            <option value="all">All</option>
          </select>
        </div>
        <button className="btn btn-secondary" type="submit">
          Filter queue
        </button>
      </form>
      {trustQueue.length === 0 ? (
        <Card>
          <p className="muted">No TRUST records match this queue filter.</p>
        </Card>
      ) : (
        trustQueue.map((item) => (
          <Card as="article" key={item.assessmentId}>
            <div className="btn-row">
              <ProvenanceBadge
                kind={
                  item.verificationState === "platform-verified"
                    ? "human-reviewed"
                    : item.verificationState === "unverified-import"
                      ? "repository-fact"
                      : "warning"
                }
              >
                {item.verificationState.replaceAll("-", " ")}
              </ProvenanceBadge>
              <a href={`/reviews/${item.reviewSlug}`} className="mono">
                {item.reviewSlug}
              </a>
              <span className="muted">{item.relationType}</span>
            </div>
            <p className="claim-text">{item.claimText}</p>
            <p className="muted">
              Citation {item.citationLocalId}
              {item.citationTitle ? ` — ${item.citationTitle}` : ""}
            </p>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th>Provenance</th>
                    <th>Status</th>
                    <th>Assessor</th>
                    <th>Aggregate</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Repository assertion</td>
                    <td>{item.sourceReviewStatus ?? "not supplied"}</td>
                    <td>{item.sourceAssessorType ?? "not supplied"}</td>
                    <td>{item.sourceAggregateScore ?? "null / not supplied"}</td>
                  </tr>
                  <tr>
                    <td>Atlas-computed public value</td>
                    <td>{item.effectiveStatus.replaceAll("-", " ")}</td>
                    <td>{item.reviewerLogin ?? "not reviewed"}</td>
                    <td>{item.computedAggregateScore ?? "not computable"}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {item.rationale ? (
              <p className="muted">
                Existing marker ({item.reviewerRoleSnapshot}): {item.rationale}
              </p>
            ) : null}
            <TrustVerificationForm
              assessmentId={item.assessmentId}
              revision={item.revision}
              assessmentHash={item.assessmentHash}
            />
          </Card>
        ))
      )}

      <h2>Recent decisions</h2>
      {decided.length === 0 ? (
        <p className="muted">No decisions yet.</p>
      ) : (
        <ul className="review-list">
          {decided.map((s) => (
            <li key={s.id} className="review-item">
              <StatusPill status={s.status} /> {s.repository.owner}/{s.repository.name}
              {s.editorialNote ? <span className="muted"> — {s.editorialNote}</span> : null}
            </li>
          ))}
        </ul>
      )}

      <h2>Audit log</h2>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Subject</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((e, i) => (
              <tr key={i}>
                <td className="muted">{e.createdAt.replace("T", " ").slice(0, 19)}</td>
                <td>{e.actorLogin ?? "system"}</td>
                <td className="mono">{e.action}</td>
                <td className="muted">
                  {e.subjectType}:{e.subjectId.slice(0, 8)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
