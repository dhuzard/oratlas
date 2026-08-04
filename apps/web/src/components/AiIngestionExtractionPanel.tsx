"use client";

import { useState } from "react";
import { LlmCredentialPanel } from "./LlmCredentialPanel";

interface SourceGrounding {
  sourcePath: string;
  sourceQuote: string;
}

interface ExtractionDecision {
  decision: "extract";
  claims: Array<{
    temporaryId: string;
    text: string;
    claimType: string;
    qualification?: string;
    source: SourceGrounding;
  }>;
  evidence: Array<{
    temporaryId: string;
    title: string;
    kind: string;
    doi?: string;
    url?: string;
    source: SourceGrounding;
  }>;
  relations: Array<{
    claimId: string;
    evidenceId: string;
    relationType: string;
    rationale: string;
  }>;
  limitations: string[];
}

interface AbstainDecision {
  decision: "abstain";
  reason: string;
  missingEvidence: string[];
}

interface ExtractionResponse {
  status?: "extracted" | "abstained";
  agentRunId?: string;
  packetHash?: string;
  capturePayloadHash?: string;
  sentFiles?: string[];
  decision?: ExtractionDecision | AbstainDecision;
  error?: { message?: string };
}

export function AiIngestionExtractionPanel({
  captureToken,
  capturePayloadHash,
}: {
  captureToken: string;
  capturePayloadHash: string;
}) {
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState<ExtractionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function extract() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/inspect/ai-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inspectionToken: captureToken, instruction }),
      });
      const data = (await response.json()) as ExtractionResponse;
      if (!response.ok) {
        setError(data.error?.message ?? "AI extraction failed.");
        return;
      }
      setResult(data);
    } catch {
      setError("Network error during AI extraction.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="ai-ingestion-title">
      <p className="home-eyebrow">Optional AI annotation</p>
      <h3 id="ai-ingestion-title">Propose missing claims and evidence</h3>
      <p className="muted">
        This sends selected, bounded text files from the exact immutable inspection to your chosen
        provider. Every candidate must quote a transmitted file verbatim. Results are stored as an
        AgentRun for review, but are <strong>not source-authored records</strong>, are not merged into
        deterministic extraction, and are not submitted or published automatically.
      </p>
      <p className="mono muted">Inspection capture SHA-256 {capturePayloadHash}</p>
      <LlmCredentialPanel compact />
      <div className="field">
        <label htmlFor="ai-extraction-instruction">Optional extraction focus</label>
        <textarea
          id="ai-extraction-instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          maxLength={2_000}
          placeholder="For example: focus on explicit empirical claims and linked datasets; ignore project-roadmap statements."
        />
      </div>
      <button className="btn" type="button" disabled={busy} onClick={() => void extract()}>
        {busy ? "Checking captured files…" : "Generate reviewable candidates"}
      </button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {result?.decision ? <ExtractionResult result={result} /> : null}
    </section>
  );
}

function ExtractionResult({ result }: { result: ExtractionResponse }) {
  const decision = result.decision!;
  return (
    <div className="ai-extraction-result" aria-live="polite">
      <p className="muted">
        AgentRun <span className="mono">{result.agentRunId}</span> · packet SHA-256{" "}
        <span className="mono">{result.packetHash}</span>
      </p>
      <details>
        <summary>Files sent to the provider ({result.sentFiles?.length ?? 0})</summary>
        <ul>{result.sentFiles?.map((path) => <li className="mono" key={path}>{path}</li>)}</ul>
      </details>
      {decision.decision === "abstain" ? (
        <div className="notice notice-info">
          <strong>The model abstained.</strong> {decision.reason}
          {decision.missingEvidence.length > 0 ? (
            <ul>{decision.missingEvidence.map((item) => <li key={item}>{item}</li>)}</ul>
          ) : null}
        </div>
      ) : (
        <>
          <h4>Claim candidates ({decision.claims.length})</h4>
          {decision.claims.map((claim) => (
            <article className="claim-card" key={claim.temporaryId}>
              <p><strong>{claim.claimType}</strong> · {claim.text}</p>
              {claim.qualification ? <p className="muted">{claim.qualification}</p> : null}
              <Grounding source={claim.source} />
            </article>
          ))}
          <h4>Evidence candidates ({decision.evidence.length})</h4>
          {decision.evidence.length === 0 ? <p className="muted">No explicit evidence object proposed.</p> : null}
          {decision.evidence.map((evidence) => (
            <article className="claim-card" key={evidence.temporaryId}>
              <p><strong>{evidence.kind}</strong> · {evidence.title}</p>
              <p className="muted">
                {evidence.doi ? `DOI ${evidence.doi}` : ""}
                {evidence.url ? ` · ${evidence.url}` : ""}
              </p>
              <Grounding source={evidence.source} />
            </article>
          ))}
          <details open={decision.relations.length > 0}>
            <summary>Proposed claim–evidence relations ({decision.relations.length})</summary>
            <ul>
              {decision.relations.map((relation, index) => (
                <li key={`${relation.claimId}:${relation.evidenceId}:${index}`}>
                  <span className="mono">{relation.claimId}</span> →{" "}
                  <span className="mono">{relation.evidenceId}</span> ·{" "}
                  {relation.relationType.replace(/-/g, " ")} — {relation.rationale}
                </li>
              ))}
            </ul>
          </details>
          {decision.limitations.length > 0 ? (
            <details>
              <summary>Extraction limitations ({decision.limitations.length})</summary>
              <ul>{decision.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

function Grounding({ source }: { source: SourceGrounding }) {
  return (
    <details>
      <summary>Exact source: {source.sourcePath}</summary>
      <blockquote>{source.sourceQuote}</blockquote>
    </details>
  );
}
