"use client";

import { useState } from "react";
import type { EditorialSynthesisDraft } from "@oratlas/contracts";

const relationTypes = [
  "contradicts",
  "derives-from",
  "extends",
  "replicates",
  "supports",
  "uses-code",
  "uses-dataset",
] as const;

export function SynthesisDraftPanel({ drafts }: { drafts: EditorialSynthesisDraft[] }) {
  const [nodeId, setNodeId] = useState("");
  const [message, setMessage] = useState("");

  async function generate() {
    setMessage("Generating…");
    const response = await fetch("/api/editorial/syntheses/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requestKey: crypto.randomUUID(),
        selector: {
          schemaVersion: "synthesis-selector/1.0.0",
          selection: { kind: "seed", nodeId },
          depth: 2,
          maxNodes: 50,
          maxEdges: 200,
          relationTypes,
          trustPolicy: "authoritative-current-relation-trust-v1",
          currentVersionPolicy: "newest-valid-no-history-fallback",
          topicSeedPolicy: "current-public-title-abstract-search-v1",
          topicSeedLimit: 5,
          edgePolicy: "editor-confirmed-exact-versions-only",
          includeContradictions: true,
        },
      }),
    });
    setMessage(response.ok ? "Draft generated. Reload to review it." : "Generation failed.");
  }

  async function decide(
    draft: EditorialSynthesisDraft,
    action: "accept" | "reject" | "request-regeneration",
  ) {
    setMessage("Recording decision…");
    const acceptance =
      action === "accept"
        ? {
            licenseSpdx: "CC-BY-4.0",
            rightsStatement:
              "The approving editor confirms that this synthesis may be published under the stated license.",
            checklist: {
              groundingAndCitationsReviewed: true,
              contradictionAndNonConsensusFramingReviewed: true,
              attributionAndAiDisclosureReviewed: true,
              limitationsReviewed: true,
              privacyAndInjectionLeakageReviewed: true,
              rightsAndLicenseConfirmed: true,
            },
          }
        : {};
    const response = await fetch(`/api/editorial/syntheses/${draft.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        expectedRevision: draft.revision,
        idempotencyKey: crypto.randomUUID(),
        rationale:
          action === "accept"
            ? "Grounding, framing, attribution, limitations, privacy, rights and licensing were reviewed."
            : "Editorial review requires a different synthesis outcome before publication.",
        ...acceptance,
      }),
    });
    setMessage(
      response.ok
        ? "Decision recorded. Reload to see the new state."
        : "Decision failed; reload and retry.",
    );
  }

  return (
    <section>
      <h2>AI-written synthesis drafts</h2>
      <p className="muted">
        Generation is private. Nothing becomes public until an editor accepts the immutable draft.
      </p>
      <div className="btn-row">
        <label>
          Seed node ID <input value={nodeId} onChange={(event) => setNodeId(event.target.value)} />
        </label>
        <button type="button" disabled={!nodeId.trim()} onClick={generate}>
          Generate synthesis
        </button>
      </div>
      {message ? <p aria-live="polite">{message}</p> : null}
      {drafts.map((draft) => (
        <article className="card" data-draft-id={draft.id} key={draft.id}>
          <p>
            <strong>{draft.document.title}</strong> · {draft.status} · attempt{" "}
            {draft.regenerationOrdinal}
          </p>
          <p>{draft.document.summary}</p>
          <details>
            <summary>Grounding and provenance</summary>
            <p className="mono">
              {draft.provenance.provider}/{draft.provenance.model} · packet{" "}
              {draft.provenance.packetHash}
            </p>
            <ul>
              {draft.citations.map((citation) => (
                <li key={`${citation.location}:${citation.occurrenceOrdinal}`}>
                  <a href={`/nodes/${citation.nodeId}/versions/${citation.nodeVersionId}`}>
                    {citation.title}
                  </a>
                  {` — ${citation.location}`}
                </li>
              ))}
            </ul>
          </details>
          {draft.status === "pending" ? (
            <div className="btn-row">
              <button type="button" onClick={() => decide(draft, "accept")}>
                Accept and publish
              </button>
              <button type="button" onClick={() => decide(draft, "reject")}>
                Reject
              </button>
              <button type="button" onClick={() => decide(draft, "request-regeneration")}>
                Request regeneration
              </button>
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}
