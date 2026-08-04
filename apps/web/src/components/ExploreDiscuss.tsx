"use client";

import { useState } from "react";
import { LlmCredentialPanel } from "./LlmCredentialPanel";

interface DiscussionReference {
  kind: "claim" | "citation";
  id: string;
  label: string;
  href: string;
}

interface LlmAnswer {
  answer: string;
  scope: string;
  agreements: string[];
  disagreements: string[];
  uncertainties: string[];
  missingEvidence: string[];
  reviewClaimsUsed: string[];
  citationsUsed: string[];
}

interface DeterministicResult {
  matchedClaimCount: number;
  reviewsCovered: Array<{ reviewSlug: string; title: string }>;
  insufficientEvidence: boolean;
  groups: Array<{
    relationType: string;
    claims: Array<{
      claimId: string;
      text: string;
      reviewTitle: string;
      reviewVersionId: string;
      localClaimId: string;
    }>;
  }>;
}

interface DiscussResponse {
  mode: "deterministic" | "llm";
  result: DeterministicResult | { answer?: LlmAnswer; error?: string };
  deterministic?: DeterministicResult;
  packetHash: string;
  references: DiscussionReference[];
  llmSource?: "byok" | "platform" | "none";
  error?: { message?: string };
}

export function ExploreDiscuss({ topic, interests }: { topic?: string; interests: string[] }) {
  const [question, setQuestion] = useState(() => suggestedQuestion(topic, interests));
  const [response, setResponse] = useState<DiscussResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const request = await fetch("/api/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = (await request.json()) as DiscussResponse;
      if (!request.ok) {
        setError(data.error?.message ?? "Grounded discussion failed.");
        return;
      }
      setResponse(data);
    } catch {
      setError("Network error while asking ORAtlas.");
    } finally {
      setBusy(false);
    }
  }

  const deterministic =
    response?.mode === "deterministic"
      ? (response.result as DeterministicResult)
      : response?.deterministic;
  const llm =
    response?.mode === "llm"
      ? (response.result as { answer?: LlmAnswer; error?: string })
      : undefined;

  return (
    <section className="explore-discuss" aria-labelledby="explore-discuss-title">
      <div>
        <p className="home-eyebrow">Atlas Discuss</p>
        <h2 id="explore-discuss-title">Ask the evidence, not a generic chatbot</h2>
        <p>
          ORAtlas first retrieves accepted claims and their explicit citation relations. Generated
          prose is optional; the deterministic evidence summary and grounding references remain
          available in every mode.
        </p>
      </div>
      <LlmCredentialPanel compact />
      <div className="field">
        <label htmlFor="explore-discuss-question">Question</label>
        <textarea
          id="explore-discuss-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          maxLength={1_000}
          placeholder="What does the accepted evidence say, where does it disagree, and what is missing?"
        />
      </div>
      <div className="btn-row">
        <button
          className="btn"
          type="button"
          disabled={busy || question.trim().length < 3}
          onClick={() => void ask()}
        >
          {busy ? "Checking evidence…" : "Ask Atlas Discuss"}
        </button>
        <a href="/discuss">Open the full grounded Q&amp;A tool</a>
      </div>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {response ? (
        <article className="card" aria-live="polite">
          <p className="muted">
            Mode: <strong>{response.mode === "llm" ? "grounded LLM" : "deterministic"}</strong>
            {response.llmSource && response.llmSource !== "none"
              ? ` · ${response.llmSource === "byok" ? "browser" : "platform"} provider`
              : ""}
          </p>
          {llm?.answer ? (
            <CompactLlmAnswer answer={llm.answer} references={response.references} />
          ) : null}
          {llm && !llm.answer ? (
            <p className="notice notice-warning">
              The provider response failed grounding validation ({llm.error ?? "unknown error"}).
              The deterministic evidence view is shown below.
            </p>
          ) : null}
          {deterministic ? <CompactDeterministic result={deterministic} /> : null}
          <p className="mono muted">Evidence packet SHA-256 {response.packetHash}</p>
        </article>
      ) : null}
    </section>
  );
}

function CompactLlmAnswer({
  answer,
  references,
}: {
  answer: LlmAnswer;
  references: DiscussionReference[];
}) {
  const used = new Set([...answer.reviewClaimsUsed, ...answer.citationsUsed]);
  return (
    <div className="prose">
      <p>{answer.answer}</p>
      <p className="muted">Scope: {answer.scope}</p>
      <CompactList title="Disagreements" items={answer.disagreements} />
      <CompactList title="Uncertainties" items={answer.uncertainties} />
      <CompactList title="Missing evidence" items={answer.missingEvidence} />
      <details>
        <summary>Grounding references ({used.size})</summary>
        <ul>
          {references
            .filter((reference) => used.has(reference.id))
            .map((reference) => (
              <li key={`${reference.kind}:${reference.id}`}>
                <a href={reference.href}>{reference.label}</a> ({reference.kind})
              </li>
            ))}
        </ul>
      </details>
    </div>
  );
}

function CompactDeterministic({ result }: { result: DeterministicResult }) {
  if (result.insufficientEvidence) {
    return <p className="notice notice-info">No matching accepted claim was found.</p>;
  }
  return (
    <details open={!result.insufficientEvidence}>
      <summary>
        Deterministic evidence view: {result.matchedClaimCount} claim(s) across{" "}
        {result.reviewsCovered.length} review(s)
      </summary>
      <ul>
        {result.groups
          .flatMap((group) => group.claims.map((claim) => ({ group: group.relationType, claim })))
          .slice(0, 6)
          .map(({ group, claim }) => (
            <li key={claim.claimId}>
              <a
                href={`/claims/${claim.reviewVersionId}/${encodeURIComponent(claim.localClaimId)}`}
              >
                {claim.text}
              </a>{" "}
              <span className="muted">({group.replace(/-/g, " ")})</span>
            </li>
          ))}
      </ul>
    </details>
  );
}

function CompactList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <details>
      <summary>
        {title} ({items.length})
      </summary>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  );
}

function suggestedQuestion(topic: string | undefined, interests: string[]): string {
  const focus = interests.map((interest) => interest.replace(/-/g, " ")).join(", ");
  if (topic?.trim()) {
    return `What does the accepted evidence in ORAtlas say about ${topic.trim()}?${
      focus ? ` Focus on ${focus}.` : ""
    } Distinguish agreement, disagreement, uncertainty, and missing evidence.`;
  }
  return "What are the main agreements, disagreements, uncertainties, and evidence gaps in the accepted ORAtlas material?";
}
