"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DecisionForm({
  submissionId,
  overrideCheckIds = [],
}: {
  submissionId: string;
  overrideCheckIds?: string[];
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [overrideRationales, setOverrideRationales] = useState<Record<string, string>>({});

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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data?.error?.message ?? "Decision failed.");
        return;
      }
      setMessage(
        decision === "accept"
          ? `Accepted — published as ${data.reviewSlug}.`
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
      <div className="field">
        <label htmlFor={`note-${submissionId}`}>Editorial note (optional)</label>
        <textarea
          id={`note-${submissionId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
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
