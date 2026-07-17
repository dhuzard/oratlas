"use client";

import { useState } from "react";

interface Proposal {
  id: string;
  revision: number;
  reviewSlug: string;
  reviewTitle: string;
  acceptedReviewVersionId: string;
  reasonCodes: string[];
  affectedReferences: Array<{
    kind: "node" | "edge" | "trust" | "policy";
    id: string;
    change: "added" | "removed" | "changed";
    previousVersionId?: string;
    currentVersionId?: string;
  }>;
  affectedReferenceCount: number;
  affectedReferencesTruncated: boolean;
  createdAt: string;
}

export function SynthesisStalenessPanel({
  proposals,
  nextCursor,
}: {
  proposals: Proposal[];
  nextCursor?: string;
}) {
  const [message, setMessage] = useState("");

  async function scan() {
    setMessage("Scanning accepted synthesis heads…");
    const response = await fetch("/api/editorial/syntheses/staleness/scan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    setMessage(response.ok ? "Scan complete. Reload to see proposals." : "Scan failed.");
  }

  async function decide(proposal: Proposal, action: "request-regeneration" | "dismiss") {
    setMessage("Recording proposal decision…");
    const response = await fetch(`/api/editorial/syntheses/staleness/${proposal.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        expectedRevision: proposal.revision,
        idempotencyKey: crypto.randomUUID(),
        rationale:
          action === "request-regeneration"
            ? "The editor requests a new private draft based on the recorded evidence changes."
            : "The editor reviewed this bounded freshness signal and dismissed the proposal.",
      }),
    });
    setMessage(
      response.ok ? "Decision recorded. Reload to refresh the queue." : "Decision failed.",
    );
  }

  return (
    <section>
      <div className="btn-row">
        <h2>Synthesis freshness ({proposals.length} open)</h2>
        <button type="button" onClick={scan}>
          Scan accepted syntheses
        </button>
      </div>
      <p className="muted">
        Scans only create private regeneration proposals. They never run a provider, create a draft,
        or publish a review.
      </p>
      {message ? <p aria-live="polite">{message}</p> : null}
      {proposals.length === 0 ? <p className="muted">No open regeneration proposals.</p> : null}
      {proposals.map((proposal) => (
        <article className="card" key={proposal.id} data-staleness-proposal={proposal.id}>
          <p>
            <strong>{proposal.reviewTitle}</strong> · {proposal.affectedReferenceCount} affected
            references{proposal.affectedReferencesTruncated ? " (bounded preview)" : ""}
          </p>
          <p className="mono">{proposal.reasonCodes.join(", ")}</p>
          <details>
            <summary>Inspect bounded affected references</summary>
            <ul>
              {proposal.affectedReferences.map((reference, index) => (
                <li key={`${reference.kind}:${reference.id}:${reference.change}:${index}`}>
                  <span className="mono">
                    {reference.kind} {reference.id} · {reference.change}
                  </span>
                  {reference.previousVersionId ? (
                    <>
                      {" "}
                      · old{" "}
                      <a href={`/nodes/${reference.id}/versions/${reference.previousVersionId}`}>
                        {reference.previousVersionId}
                      </a>
                    </>
                  ) : null}
                  {reference.currentVersionId ? (
                    <>
                      {" "}
                      · new{" "}
                      <a href={`/nodes/${reference.id}/versions/${reference.currentVersionId}`}>
                        {reference.currentVersionId}
                      </a>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
          <p>
            <a href={`/reviews/${proposal.reviewSlug}`}>View current public synthesis</a>
          </p>
          <div className="btn-row">
            <button type="button" onClick={() => decide(proposal, "request-regeneration")}>
              Request private regeneration
            </button>
            <button type="button" onClick={() => decide(proposal, "dismiss")}>
              Dismiss
            </button>
          </div>
        </article>
      ))}
      {nextCursor ? (
        <p>
          <a href={`/editorial?synthesisCursor=${encodeURIComponent(nextCursor)}`}>
            Next proposal page →
          </a>
        </p>
      ) : null}
    </section>
  );
}
