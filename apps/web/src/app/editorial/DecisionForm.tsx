"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DecisionForm({ submissionId }: { submissionId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(decision: "accept" | "reject" | "request-changes") {
    setLoading(decision);
    setMessage(null);
    try {
      const res = await fetch("/api/editorial/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, decision, note: note || undefined }),
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
      <div className="btn-row">
        <button className="btn" onClick={() => decide("accept")} disabled={loading !== null}>
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
