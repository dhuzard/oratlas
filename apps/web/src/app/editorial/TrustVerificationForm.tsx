"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function TrustVerificationForm({
  assessmentId,
  subjectType = "claim-citation",
  revision,
  assessmentHash,
}: {
  assessmentId: string;
  subjectType?: "claim-citation" | "node-relation";
  revision: number;
  assessmentHash: string;
}) {
  const router = useRouter();
  const [rationale, setRationale] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(status: "human-reviewed" | "adjudicated") {
    setPending(status);
    setMessage(null);
    try {
      const response = await fetch("/api/editorial/trust", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          subjectType,
          status,
          rationale,
          expectedRevision: revision,
          expectedAssessmentHash: assessmentHash,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        setMessage(result?.error?.message ?? "TRUST verification failed.");
        return;
      }
      setMessage(status === "adjudicated" ? "Adjudication recorded." : "Review recorded.");
      router.refresh();
    } catch {
      setMessage("Network error.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div className="field">
        <label htmlFor={`trust-rationale-${assessmentId}`}>Structural-review rationale</label>
        <textarea
          id={`trust-rationale-${assessmentId}`}
          minLength={10}
          maxLength={4_000}
          required
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
          placeholder="Describe what provenance, criteria, and evidence pointers you checked."
        />
      </div>
      <div className="btn-row">
        <button
          className="btn"
          type="button"
          disabled={pending !== null || rationale.trim().length < 10}
          onClick={() => submit("human-reviewed")}
        >
          {pending === "human-reviewed" ? "Recording…" : "Record structural review"}
        </button>
        <button
          className="btn btn-secondary"
          type="button"
          disabled={pending !== null || rationale.trim().length < 10}
          onClick={() => submit("adjudicated")}
        >
          {pending === "adjudicated" ? "Recording…" : "Record adjudication"}
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
