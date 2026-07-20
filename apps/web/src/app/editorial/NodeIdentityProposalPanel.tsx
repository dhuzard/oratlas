"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-post";

interface Proposal {
  id: string;
  revision: number;
  signals: string[];
  textSimilarity?: number;
  methodVersion: string;
  source: { localNodeId: string; title: string; repository: string };
  target: { localNodeId: string; title: string; repository: string };
}

export function NodeIdentityProposalPanel({ proposals }: { proposals: Proposal[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function decide(proposal: Proposal, decision: "confirm" | "reject") {
    setBusy(true);
    setMessage(null);
    const error = await postJson(`/api/editorial/node-identity-proposals/${proposal.id}/decision`, {
      decision,
      expectedRevision: proposal.revision,
      note: notes[proposal.id] ?? "",
    });
    setBusy(false);
    if (error) setMessage(error);
    else router.refresh();
  }

  if (proposals.length === 0) return <p className="muted">No pending same-claim proposals.</p>;
  return (
    <div>
      {proposals.map((proposal) => (
        <article className="claim-card" key={proposal.id}>
          <p>
            <strong>Possible same claim</strong> · proposal only — stable nodes remain separate
          </p>
          <p>
            <span className="mono">{proposal.source.localNodeId}</span> ({proposal.source.title}) ↔{" "}
            <span className="mono">{proposal.target.localNodeId}</span> ({proposal.target.title})
          </p>
          <p className="muted">
            Signals: {proposal.signals.join(", ")}
            {proposal.textSimilarity !== undefined
              ? ` · similarity ${proposal.textSimilarity.toFixed(3)}`
              : ""}
            {` · ${proposal.methodVersion}`}
          </p>
          <p className="muted">
            {proposal.source.repository} ↔ {proposal.target.repository}
          </p>
          <div className="btn-row">
            <input
              aria-label={`Decision note for ${proposal.id}`}
              value={notes[proposal.id] ?? ""}
              onChange={(event) =>
                setNotes((current) => ({ ...current, [proposal.id]: event.target.value }))
              }
              placeholder="Attributable decision note (at least 10 characters)"
              style={{ minWidth: "24rem" }}
            />
            <button
              className="btn"
              disabled={busy}
              type="button"
              onClick={() => void decide(proposal, "confirm")}
            >
              Confirm same claim
            </button>
            <button
              className="btn btn-secondary"
              disabled={busy}
              type="button"
              onClick={() => void decide(proposal, "reject")}
            >
              Reject
            </button>
          </div>
        </article>
      ))}
      {message ? <p className="form-error">{message}</p> : null}
    </div>
  );
}
