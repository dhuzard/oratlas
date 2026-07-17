"use client";

import { useState } from "react";
import { synthesisDraftDecisionSchema, type EditorialSynthesisDraft } from "@oratlas/contracts";

const relationTypes = [
  "contradicts",
  "derives-from",
  "extends",
  "replicates",
  "supports",
  "uses-code",
  "uses-dataset",
] as const;

const checklistFields = [
  ["groundingAndCitationsReviewed", "Grounding and citations reviewed"],
  [
    "contradictionAndNonConsensusFramingReviewed",
    "Contradiction and non-consensus framing reviewed",
  ],
  ["attributionAndAiDisclosureReviewed", "Attribution and AI disclosure reviewed"],
  ["limitationsReviewed", "Limitations reviewed"],
  ["privacyAndInjectionLeakageReviewed", "Privacy and prompt-injection leakage reviewed"],
  ["rightsAndLicenseConfirmed", "Rights and license confirmed"],
] as const;

type ChecklistKey = (typeof checklistFields)[number][0];
type ChecklistState = Record<ChecklistKey, boolean>;

const emptyChecklist: ChecklistState = {
  groundingAndCitationsReviewed: false,
  contradictionAndNonConsensusFramingReviewed: false,
  attributionAndAiDisclosureReviewed: false,
  limitationsReviewed: false,
  privacyAndInjectionLeakageReviewed: false,
  rightsAndLicenseConfirmed: false,
};

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

  return (
    <section>
      <h2>AI-written synthesis drafts</h2>
      <p className="muted">
        Generation is private. Nothing becomes public until an editor inspects and explicitly
        accepts the immutable draft.
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
        <SynthesisDraftCard draft={draft} key={draft.id} onMessage={setMessage} />
      ))}
    </section>
  );
}

function SynthesisDraftCard({
  draft,
  onMessage,
}: {
  draft: EditorialSynthesisDraft;
  onMessage: (message: string) => void;
}) {
  const [checklist, setChecklist] = useState<ChecklistState>({ ...emptyChecklist });
  const [licenseSpdx, setLicenseSpdx] = useState("");
  const [rightsStatement, setRightsStatement] = useState("");
  const [rationale, setRationale] = useState("");
  const [versionDoi, setVersionDoi] = useState("");
  const [conceptDoi, setConceptDoi] = useState("");

  function decisionValue(
    action: "accept" | "reject" | "request-regeneration",
    idempotencyKey: string,
  ) {
    return {
      action,
      expectedRevision: draft.revision,
      idempotencyKey,
      rationale,
      ...(action === "accept"
        ? {
            licenseSpdx,
            rightsStatement,
            versionDoi: versionDoi.trim() || undefined,
            conceptDoi: conceptDoi.trim() || undefined,
            checklist,
          }
        : {}),
    };
  }

  const canAccept = synthesisDraftDecisionSchema.safeParse(
    decisionValue("accept", "validation-key"),
  ).success;
  const canReject = synthesisDraftDecisionSchema.safeParse(
    decisionValue("reject", "validation-key"),
  ).success;
  const canRegenerate = synthesisDraftDecisionSchema.safeParse(
    decisionValue("request-regeneration", "validation-key"),
  ).success;

  async function decide(action: "accept" | "reject" | "request-regeneration") {
    const decision = synthesisDraftDecisionSchema.safeParse(
      decisionValue(action, crypto.randomUUID()),
    );
    if (!decision.success) {
      onMessage("Complete the required editorial fields before recording this decision.");
      return;
    }
    onMessage("Recording decision…");
    const response = await fetch(`/api/editorial/syntheses/${draft.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(decision.data),
    });
    onMessage(
      response.ok
        ? "Decision recorded. Reload to see the new state."
        : "Decision failed; reload and retry.",
    );
  }

  return (
    <article className="card" data-draft-id={draft.id}>
      <p>
        <strong>{draft.document.title}</strong> · {draft.status} · attempt{" "}
        {draft.regenerationOrdinal}
      </p>
      <p>{draft.document.summary}</p>
      <section aria-label="Complete immutable synthesis draft">
        {draft.document.sections.map((section) => (
          <section key={section.id}>
            <h3>{section.title}</h3>
            {section.paragraphs.map((paragraph, paragraphIndex) => (
              <div key={`${section.id}:${paragraphIndex}`}>
                <p>{paragraph.text}</p>
                {paragraph.citations.length ? (
                  <ul aria-label={`${section.title} paragraph ${paragraphIndex + 1} citations`}>
                    {paragraph.citations.map((citation) => {
                      const stored = draft.citations.find(
                        (candidate) => candidate.referenceId === citation.referenceId,
                      );
                      return (
                        <li key={citation.referenceId}>
                          <a href={`/nodes/${citation.nodeId}/versions/${citation.nodeVersionId}`}>
                            {stored?.title ?? citation.referenceId}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ))}
          </section>
        ))}
      </section>
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
        <form onSubmit={(event) => event.preventDefault()}>
          <fieldset>
            <legend>Required acceptance affirmations</legend>
            {checklistFields.map(([key, label]) => (
              <label key={key} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  checked={checklist[key]}
                  onChange={(event) =>
                    setChecklist((current) => ({ ...current, [key]: event.target.checked }))
                  }
                />{" "}
                {label}
              </label>
            ))}
          </fieldset>
          <label style={{ display: "block" }}>
            SPDX license expression
            <input value={licenseSpdx} onChange={(event) => setLicenseSpdx(event.target.value)} />
          </label>
          <label style={{ display: "block" }}>
            Rights statement
            <textarea
              value={rightsStatement}
              onChange={(event) => setRightsStatement(event.target.value)}
            />
          </label>
          <label style={{ display: "block" }}>
            Editorial rationale
            <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} />
          </label>
          <label style={{ display: "block" }}>
            Version DOI (optional)
            <input value={versionDoi} onChange={(event) => setVersionDoi(event.target.value)} />
          </label>
          <label style={{ display: "block" }}>
            Concept DOI (optional)
            <input value={conceptDoi} onChange={(event) => setConceptDoi(event.target.value)} />
          </label>
          <div className="btn-row">
            <button type="button" disabled={!canAccept} onClick={() => decide("accept")}>
              Accept and publish
            </button>
            <button type="button" disabled={!canReject} onClick={() => decide("reject")}>
              Reject
            </button>
            <button
              type="button"
              disabled={!canRegenerate}
              onClick={() => decide("request-regeneration")}
            >
              Request regeneration
            </button>
          </div>
        </form>
      ) : null}
    </article>
  );
}
