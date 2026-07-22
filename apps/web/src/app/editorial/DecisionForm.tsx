"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DecisionForm({
  submissionId,
  overrideCheckIds = [],
  nodeCandidates = [],
  nodeOnly = false,
}: {
  submissionId: string;
  overrideCheckIds?: string[];
  nodeCandidates?: Array<{
    id: string;
    kind: string;
    title: string;
    abstract?: string;
    text?: string;
    license: string;
    sourcePath: string;
    sourcePointer: string;
    fieldProvenance: Record<string, { file: string; pointer: string; commitSha?: string }>;
  }>;
  nodeOnly?: boolean;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [overrideRationales, setOverrideRationales] = useState<Record<string, string>>({});
  const [selectedNodeIds, setSelectedNodeIds] = useState(() =>
    nodeCandidates.map((candidate) => candidate.id),
  );
  const [conflictStatus, setConflictStatus] = useState("none-declared");
  const [administratorOverride, setAdministratorOverride] = useState(false);

  async function decide(decision: "accept" | "reject" | "request-changes") {
    setLoading(decision);
    setMessage(null);
    try {
      const res = await fetch("/api/editorial/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          decision,
          note: note || undefined,
          overrides:
            decision === "accept"
              ? overrideCheckIds.map((checkId) => ({
                  checkId,
                  rationale: overrideRationales[checkId] ?? "",
                }))
              : [],
          selectedNodeIds: decision === "accept" ? selectedNodeIds : [],
          conflictOfInterest: { status: conflictStatus },
          administratorOverride,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data?.error?.message ?? "Decision failed.");
        return;
      }
      setMessage(
        decision === "accept"
          ? data.reviewSlug
            ? `Accepted — published review ${data.reviewSlug} and ${data.nodeVersionIds?.length ?? 0} node(s).`
            : `Accepted — published ${data.nodeVersionIds?.length ?? 0} node(s).`
          : `Recorded: ${decision.replace(/-/g, " ")}.`,
      );
      router.refresh();
    } catch {
      setMessage("Network error.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div>
      {nodeCandidates.length > 0 ? (
        <fieldset className="field">
          <legend>Node candidates to publish</legend>
          <p className="muted">
            Selection is verified against the immutable capture. Unselected candidates remain
            private.
          </p>
          {nodeCandidates.map((candidate) => (
            <label key={candidate.id} style={{ display: "block", marginBottom: "0.8rem" }}>
              <input
                type="checkbox"
                checked={selectedNodeIds.includes(candidate.id)}
                onChange={(event) =>
                  setSelectedNodeIds((current) =>
                    event.target.checked
                      ? [...current, candidate.id]
                      : current.filter((id) => id !== candidate.id),
                  )
                }
              />{" "}
              <strong>{candidate.title}</strong> [{candidate.kind}] · {candidate.id}
              {candidate.abstract ? <span> — {candidate.abstract}</span> : null}
              {candidate.text ? <span> — {candidate.text}</span> : null}
              <small className="mono" style={{ display: "block" }}>
                {candidate.sourcePath} {candidate.sourcePointer} · {candidate.license}
              </small>
              <small className="muted" style={{ display: "block" }}>
                Provenance: {Object.keys(candidate.fieldProvenance).sort().join(", ") || "record"}
              </small>
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="field">
        <label htmlFor={`note-${submissionId}`}>Editorial note (optional)</label>
        <textarea
          id={`note-${submissionId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`coi-${submissionId}`}>Conflict-of-interest snapshot</label>
        <select
          id={`coi-${submissionId}`}
          value={conflictStatus}
          onChange={(event) => setConflictStatus(event.target.value)}
        >
          <option value="none-declared">none declared</option>
          <option value="conflict-declared">conflict declared</option>
          <option value="not-provided">not provided</option>
        </select>
        <label style={{ display: "block", marginTop: "0.5rem" }}>
          <input
            type="checkbox"
            checked={administratorOverride}
            onChange={(event) => setAdministratorOverride(event.target.checked)}
          />{" "}
          Exercise ADMIN recusal override (direct involvement only)
        </label>
      </div>
      {overrideCheckIds.map((checkId) => (
        <div className="field" key={checkId}>
          <label htmlFor={`override-${submissionId}-${checkId}`}>
            Override rationale for failed check <span className="mono">{checkId}</span>
          </label>
          <textarea
            id={`override-${submissionId}-${checkId}`}
            value={overrideRationales[checkId] ?? ""}
            minLength={20}
            required
            onChange={(event) =>
              setOverrideRationales({ ...overrideRationales, [checkId]: event.target.value })
            }
          />
          <small>
            This exception is check-scoped, immutable, attributed, and publicly auditable.
          </small>
        </div>
      ))}
      <div className="btn-row">
        <button
          className="btn"
          onClick={() => decide("accept")}
          disabled={
            loading !== null ||
            (nodeOnly && selectedNodeIds.length === 0) ||
            overrideCheckIds.some(
              (checkId) => (overrideRationales[checkId]?.trim().length ?? 0) < 20,
            )
          }
        >
          {loading === "accept" ? "Accepting…" : "Accept"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => decide("request-changes")}
          disabled={loading !== null}
        >
          Request changes
        </button>
        <button
          className="btn btn-danger"
          onClick={() => decide("reject")}
          disabled={loading !== null}
        >
          Reject
        </button>
      </div>
      {message ? (
        <p className="notice notice-info" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
