import { redirect } from "next/navigation";
import { type Metadata } from "next";
import { Card, Notice, StatusPill, ProvenanceBadge } from "@oratlas/ui";
import { getCurrentUser, isEditor } from "@/lib/auth";
import { listAuditEvents, listSubmissions } from "@/lib/editorial";
import { DecisionForm } from "./DecisionForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Editorial dashboard" };

export default async function EditorialPage() {
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
