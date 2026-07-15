"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-post";

interface ProposalItem {
  id: string;
  category: string;
  kind: string;
  rationale: string;
  sourceId: string;
  publicPath: string;
  createdAt: string;
}

/** Editor workflow for exact registry snapshot ingestion and proposal resolution. */
export function ProtocolDriftPanel({ proposals }: { proposals: ProposalItem[] }) {
  const router = useRouter();
  const [reviewVersionId, setReviewVersionId] = useState("");
  const [claimLocalId, setClaimLocalId] = useState("");
  const [registry, setRegistry] = useState("clinicaltrials-gov");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceVersion, setSourceVersion] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const [payload, setPayload] = useState("");
  const [osfQuestions, setOsfQuestions] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    const error = await action();
    setBusy(false);
    if (error) setMessage(error);
    else router.refresh();
  }

  function submitSnapshot(): Promise<string | null> {
    let parsedPayload: unknown;
    let parsedQuestions: unknown;
    try {
      parsedPayload = JSON.parse(payload);
      parsedQuestions = osfQuestions ? JSON.parse(osfQuestions) : undefined;
    } catch {
      return Promise.resolve("Snapshot payload and OSF questions must be valid JSON.");
    }
    return postJson("/api/protocols/snapshots", {
      reviewVersionId,
      claimLocalId: claimLocalId || undefined,
      registry,
      sourceUrl,
      sourceVersion,
      fetchedAt,
      payload: parsedPayload,
      osfQuestions: parsedQuestions,
    });
  }

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(submitSnapshot);
        }}
      >
        <p className="muted">
          Paste an exact OSF registration or ClinicalTrials.gov v2 response. The raw snapshot,
          version marker, timestamp and SHA-256 hash remain auditable; no network request is made
          during ingestion.
        </p>
        <div className="btn-row">
          <input
            required
            value={reviewVersionId}
            onChange={(event) => setReviewVersionId(event.target.value)}
            placeholder="Review version id"
          />
          <input
            value={claimLocalId}
            onChange={(event) => setClaimLocalId(event.target.value)}
            placeholder="Claim local id (optional)"
          />
          <select value={registry} onChange={(event) => setRegistry(event.target.value)}>
            <option value="clinicaltrials-gov">ClinicalTrials.gov v2</option>
            <option value="osf">OSF registration</option>
          </select>
        </div>
        <div className="btn-row" style={{ marginTop: "0.4rem" }}>
          <input
            required
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="Canonical registry URL"
            style={{ minWidth: "20rem" }}
          />
          <input
            required
            value={sourceVersion}
            onChange={(event) => setSourceVersion(event.target.value)}
            placeholder="Exact ETag / data version / timestamp"
            style={{ minWidth: "18rem" }}
          />
          <input
            required
            value={fetchedAt}
            onChange={(event) => setFetchedAt(event.target.value)}
            placeholder="Registry capture time (ISO 8601)"
            style={{ minWidth: "18rem" }}
          />
        </div>
        <textarea
          required
          rows={8}
          value={payload}
          onChange={(event) => setPayload(event.target.value)}
          placeholder="Exact registry JSON payload"
          style={{ width: "100%", marginTop: "0.4rem" }}
        />
        {registry === "osf" ? (
          <textarea
            required
            rows={3}
            value={osfQuestions}
            onChange={(event) => setOsfQuestions(event.target.value)}
            placeholder='OSF mapping JSON: [{"id":"q1","label":"Target population","category":"population"}]'
            style={{ width: "100%", marginTop: "0.4rem" }}
          />
        ) : null}
        <button className="btn" disabled={busy} type="submit">
          Register protocol snapshot
        </button>
      </form>

      <h3 style={{ marginTop: "1rem" }}>Open protocol proposals ({proposals.length})</h3>
      {proposals.length === 0 ? (
        <p className="muted">No open protocol reconciliation proposals.</p>
      ) : (
        proposals.map((proposal) => (
          <div className="claim-card" key={proposal.id}>
            <p>
              <strong>{proposal.category}</strong> · {proposal.kind} · {proposal.sourceId} ·{" "}
              {proposal.createdAt.slice(0, 10)}
            </p>
            <p>{proposal.rationale}</p>
            <p>
              <Link href={proposal.publicPath}>Public protocol summary</Link>
            </p>
            <div className="btn-row">
              <input
                value={resolutionNotes[proposal.id] ?? ""}
                onChange={(event) =>
                  setResolutionNotes((current) => ({
                    ...current,
                    [proposal.id]: event.target.value,
                  }))
                }
                placeholder="Attributable resolution note (≥10 characters)"
                style={{ minWidth: "22rem" }}
              />
              {(["confirmed-update-needed", "explained", "dismissed"] as const).map(
                (resolution) => (
                  <button
                    key={resolution}
                    className="btn btn-secondary"
                    disabled={busy}
                    type="button"
                    onClick={() =>
                      void run(() =>
                        postJson(`/api/protocols/proposals/${proposal.id}/resolve`, {
                          resolution,
                          note: resolutionNotes[proposal.id] ?? "",
                        }),
                      )
                    }
                  >
                    {resolution.replace(/-/g, " ")}
                  </button>
                ),
              )}
            </div>
          </div>
        ))
      )}
      {message ? <p className="form-error">{message}</p> : null}
    </div>
  );
}
