"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@oratlas/ui";
import type { TrustDisagreementQueueItem } from "@/lib/trust-adjudication";

export function TrustAdjudicationPanel({ items }: { items: TrustDisagreementQueueItem[] }) {
  const open = items.filter((item) => item.open);
  const history = items.filter((item) => !item.open && item.adjudications.length > 0);
  return (
    <section aria-labelledby="trust-disagreements-heading">
      <h2 id="trust-disagreements-heading">TRUST disagreements</h2>
      <p className="muted">
        Different explicit ratings are shown criterion by criterion. Coverage gaps remain separate;
        no rating is averaged or hidden.
      </p>
      {open.length === 0 ? (
        <Card>
          <p className="muted">
            No current assessment-lineage disagreement is awaiting adjudication.
          </p>
        </Card>
      ) : (
        open.map((item) => <AdjudicationCard key={item.disagreementHash} item={item} />)
      )}
      {history.length > 0 ? (
        <details>
          <summary>Adjudication history ({history.length})</summary>
          {history.map((item) => (
            <Card as="article" key={item.disagreementHash}>
              <p>
                <a href={item.subjectHref}>{item.subjectLabel}</a> · {item.protocolVersion}
              </p>
              {item.adjudications.map((adjudication) => (
                <p key={adjudication.id}>
                  {adjudication.outcome.replace(/-/g, " ")} · @
                  {adjudication.adjudicator.githubLogin} · {adjudication.createdAt} ·{" "}
                  {adjudication.valid ? "integrity verified" : "integrity unavailable"}
                </p>
              ))}
            </Card>
          ))}
        </details>
      ) : null}
    </section>
  );
}

function AdjudicationCard({ item }: { item: TrustDisagreementQueueItem }) {
  const router = useRouter();
  const [outcome, setOutcome] = useState("disagreement-upheld");
  const [selectedAssessmentId, setSelectedAssessmentId] = useState(item.assessments[0]?.id ?? "");
  const [rationale, setRationale] = useState("");
  const [conflictStatus, setConflictStatus] = useState("none-declared");
  const [administratorOverride, setAdministratorOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/editorial/trust/adjudications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectType: item.subjectType,
          assessmentIds: item.assessments.map(({ id }) => id),
          expectedDisagreementHash: item.disagreementHash,
          outcome,
          selectedAssessmentId: outcome === "assessment-upheld" ? selectedAssessmentId : undefined,
          rationale,
          conflictOfInterest: { status: conflictStatus },
          administratorOverride,
        }),
      });
      const result = await response.json();
      if (!response.ok) setMessage(result?.error?.message ?? "Adjudication failed.");
      else {
        setMessage("Immutable adjudication recorded.");
        router.refresh();
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="article">
      <div className="btn-row">
        <span className="badge badge-warning">Disagreement</span>
        <a href={item.subjectHref} className="mono">
          {item.subjectLabel}
        </a>
        <span className="muted">{item.protocolVersion}</span>
      </div>
      <p>
        <strong>{item.assessments.length} complete assessment profiles remain visible.</strong>
      </p>
      <ul>
        {item.report.disagreements.map((entry) => (
          <li key={entry.criterion}>
            {entry.criterion}:{" "}
            {entry.ratings
              .map((rating) => `${rating.rating} (${rating.assessmentIds.join(", ")})`)
              .join(" vs ")}
          </li>
        ))}
      </ul>
      {item.report.coverageGaps.length > 0 ? (
        <details>
          <summary>Coverage gaps ({item.report.coverageGaps.length})</summary>
          <ul>
            {item.report.coverageGaps.map((entry) => (
              <li key={entry.criterion}>
                {entry.criterion}:{" "}
                {entry.gaps.map((gap) => `${gap.assessmentId} ${gap.reason}`).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <div className="field">
        <label>Outcome</label>
        <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          <option value="disagreement-upheld">Disagreement upheld</option>
          <option value="assessment-upheld">One assessment upheld</option>
          <option value="reassessment-requested">Reassessment requested</option>
        </select>
      </div>
      {outcome === "assessment-upheld" ? (
        <div className="field">
          <label>Assessment retained as adjudicated outcome</label>
          <select
            value={selectedAssessmentId}
            onChange={(event) => setSelectedAssessmentId(event.target.value)}
          >
            {item.assessments.map((assessment) => (
              <option key={assessment.id} value={assessment.id}>
                {assessment.id} · {assessment.assessorType} {assessment.assessorId ?? "anonymous"}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="field">
        <label>Private adjudication rationale</label>
        <textarea
          minLength={20}
          maxLength={10_000}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </div>
      <div className="field">
        <label>Conflict-of-interest snapshot</label>
        <select value={conflictStatus} onChange={(event) => setConflictStatus(event.target.value)}>
          <option value="none-declared">none declared</option>
          <option value="conflict-declared">conflict declared</option>
          <option value="not-provided">not provided</option>
        </select>
        <label style={{ display: "block" }}>
          <input
            type="checkbox"
            checked={administratorOverride}
            onChange={(event) => setAdministratorOverride(event.target.checked)}
          />{" "}
          ADMIN recusal override
        </label>
      </div>
      <button
        className="btn"
        disabled={busy || rationale.trim().length < 20}
        type="button"
        onClick={submit}
      >
        {busy ? "Recording…" : "Record adjudication"}
      </button>
      {message ? (
        <p className="notice notice-info" role="status">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
