"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { postJson } from "@/lib/client-post";
import { LlmCredentialPanel } from "@/components/LlmCredentialPanel";

interface Proposal {
  id: string;
  revision: number;
  origin: string;
  relationType: string;
  rationale: string;
  source: { localNodeId: string; title: string; repository: string };
  target: { localNodeId: string; title: string; repository: string };
  agentRunId?: string;
}

interface AiProposalResponse {
  status?: "proposed" | "abstained";
  proposalId?: string;
  relationType?: string;
  reason?: string;
  missingEvidence?: string[];
  error?: { message?: string };
}

export function NodeEdgeProposalPanel({ proposals }: { proposals: Proposal[] }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [sourceNodeId, setSourceNodeId] = useState("");
  const [targetNodeId, setTargetNodeId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/editorial/node-edge-proposals/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceNodeId, targetNodeId, instruction }),
      });
      const data = (await response.json()) as AiProposalResponse;
      if (!response.ok) {
        setMessage(data.error?.message ?? "AI graph curation failed.");
        return;
      }
      if (data.status === "abstained") {
        setMessage(
          `The model abstained: ${data.reason ?? "insufficient evidence"}${
            data.missingEvidence?.length
              ? ` Missing: ${data.missingEvidence.join("; ")}`
              : ""
          }`,
        );
        return;
      }
      setMessage(
        `Created a ${data.relationType ?? "graph"} proposal. It remains non-public until an editor confirms it.`,
      );
      router.refresh();
    } catch {
      setMessage("Network error during AI graph curation.");
    } finally {
      setBusy(false);
    }
  }

  async function decide(proposal: Proposal, decision: "confirm" | "reject") {
    setBusy(true);
    setMessage(null);
    const error = await postJson(`/api/editorial/node-edge-proposals/${proposal.id}/decision`, {
      decision,
      expectedRevision: proposal.revision,
      note: notes[proposal.id] ?? "",
    });
    setBusy(false);
    if (error) setMessage(error);
    else router.refresh();
  }

  return (
    <div>
      <section className="card" aria-labelledby="ai-graph-curation-title">
        <p className="home-eyebrow">AI-assisted curation</p>
        <h3 id="ai-graph-curation-title">Propose an edge between exact public nodes</h3>
        <p className="muted">
          The model sees two exact immutable public node versions, must quote both, and may abstain.
          A successful result creates only a <strong>proposed</strong> edge in this queue. It never
          confirms or publishes the relation.
        </p>
        <LlmCredentialPanel compact />
        <div className="filters">
          <div className="field">
            <label htmlFor="ai-edge-source">Source stable node ID</label>
            <input
              id="ai-edge-source"
              value={sourceNodeId}
              onChange={(event) => setSourceNodeId(event.target.value)}
              maxLength={200}
              placeholder="KnowledgeNode.id from a public node page"
            />
          </div>
          <div className="field">
            <label htmlFor="ai-edge-target">Target stable node ID</label>
            <input
              id="ai-edge-target"
              value={targetNodeId}
              onChange={(event) => setTargetNodeId(event.target.value)}
              maxLength={200}
              placeholder="KnowledgeNode.id from a public node page"
            />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ai-edge-instruction">Optional editorial question</label>
          <textarea
            id="ai-edge-instruction"
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            maxLength={2_000}
            placeholder="For example: determine whether this claim is extended or contradicted by the target."
          />
        </div>
        <button
          className="btn"
          type="button"
          disabled={
            busy ||
            sourceNodeId.trim().length === 0 ||
            targetNodeId.trim().length === 0 ||
            sourceNodeId.trim() === targetNodeId.trim()
          }
          onClick={() => void generate()}
        >
          {busy ? "Evaluating exact versions…" : "Generate reviewable proposal"}
        </button>
      </section>

      <h3>Pending node-edge proposals ({proposals.length})</h3>
      {proposals.length === 0 ? <p className="muted">No pending node-edge proposals.</p> : null}
      {proposals.map((proposal) => (
        <article className="claim-card" key={proposal.id}>
          <p>
            <strong>{proposal.relationType}</strong> · proposal — not editor-confirmed ·{" "}
            {proposal.origin === "asserted-by-author" ? "author assertion" : "agent proposal"}
          </p>
          <p>
            <span className="mono">{proposal.source.localNodeId}</span> ({proposal.source.title}) →{" "}
            <span className="mono">{proposal.target.localNodeId}</span> ({proposal.target.title})
          </p>
          <p>{proposal.rationale}</p>
          <p className="muted">
            {proposal.source.repository} → {proposal.target.repository}
            {proposal.agentRunId ? ` · AgentRun ${proposal.agentRunId}` : ""}
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
              Confirm edge
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
      {message ? <p className="form-error" role="status">{message}</p> : null}
    </div>
  );
}
