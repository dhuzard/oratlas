"use client";
import { useState } from "react";

interface EvidenceClaim {
  claimId: string;
  localClaimId: string;
  reviewTitle: string;
  reviewSlug: string;
  reviewVersionId: string;
  text: string;
  anchor: string;
  relations: Array<{
    citationId: string;
    relationType: string;
    trust?: {
      reviewStatus: string;
      verificationState:
        "platform-verified" | "unverified-import" | "stale-verification" | "legacy-unknown";
      notableCriteria: string[];
    };
  }>;
}

interface DeterministicResult {
  mode: "deterministic";
  question: string;
  matchedClaimCount: number;
  groups: Array<{ relationType: string; claims: EvidenceClaim[] }>;
  reviewsCovered: Array<{ reviewSlug: string; title: string }>;
  insufficientEvidence: boolean;
  notes: string[];
}

interface DiscussResponse {
  mode: "deterministic" | "llm";
  result: unknown;
  llmAvailable?: boolean;
  deterministic?: DeterministicResult;
  packetHash: string;
  packetSchemaVersion: "1.1.0";
  references: DiscussionReference[];
}

interface DiscussionReference {
  kind: "claim" | "citation";
  id: string;
  label: string;
  href: string;
}

export function DiscussClient({ initialReview }: { initialReview?: string }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<DiscussResponse | null>(null);

  async function ask() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          reviewSlugs: initialReview ? [initialReview] : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message ?? "Discussion failed.");
        return;
      }
      setResponse(data as DiscussResponse);
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  const deterministic: DeterministicResult | undefined =
    response?.mode === "deterministic"
      ? (response.result as DeterministicResult)
      : response?.deterministic;
  const llm = response?.mode === "llm" ? (response.result as LlmResult) : undefined;

  return (
    <div>
      <div className="card">
        <div className="field">
          <label htmlFor="q">Your question</label>
          <textarea
            id="q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What is the evidence that hippocampal replay supports memory consolidation?"
          />
          {initialReview ? <small>Scoped to review: {initialReview}</small> : null}
        </div>
        <button className="btn" onClick={ask} disabled={loading || question.trim().length < 3}>
          {loading ? "Thinking…" : "Ask Atlas Discuss"}
        </button>
      </div>

      {error ? (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      ) : null}

      {response ? (
        <div className="card">
          <p className="muted">
            Mode: <strong>{response.mode === "llm" ? "LLM (grounded)" : "Deterministic"}</strong>.
          </p>

          {response.mode === "deterministic" && response.llmAvailable === false ? (
            <div className="notice notice-info">
              No LLM provider is configured. Atlas is showing the deterministic structured evidence
              summary; no generated prose was attempted.
            </div>
          ) : null}

          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Evidence packet {response.packetSchemaVersion}:{" "}
            <code className="mono" data-testid="discussion-packet-hash">
              {response.packetHash}
            </code>
          </p>

          {llm?.answer ? <LlmAnswer answer={llm.answer} references={response.references} /> : null}
          {llm && !llm.answer ? (
            <div className="notice notice-warning">
              The model did not produce a grounded answer ({llm.error}). Showing the deterministic
              evidence summary instead.
            </div>
          ) : null}

          {deterministic ? (
            <DeterministicView result={deterministic} references={response.references} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

interface LlmResult {
  answer?: {
    answer: string;
    scope: string;
    agreements: string[];
    disagreements: string[];
    uncertainties: string[];
    missingEvidence: string[];
    reviewClaimsUsed: string[];
    citationsUsed: string[];
  };
  error?: string;
}

function LlmAnswer({
  answer,
  references,
}: {
  answer: NonNullable<LlmResult["answer"]>;
  references: DiscussionReference[];
}) {
  const used = new Set([...answer.reviewClaimsUsed, ...answer.citationsUsed]);
  return (
    <div className="prose">
      <p>{answer.answer}</p>
      <p className="muted">
        <em>Scope:</em> {answer.scope}
      </p>
      <List title="Agreements" items={answer.agreements} />
      <List title="Disagreements" items={answer.disagreements} />
      <List title="Uncertainties" items={answer.uncertainties} />
      <List title="Missing evidence" items={answer.missingEvidence} />
      <p className="muted">
        Grounded in {answer.reviewClaimsUsed.length} claim(s) and {answer.citationsUsed.length}{" "}
        citation(s). Every claim–citation edge was validated against the evidence packet. This is
        structural grounding, not a finding that the claims are scientifically correct.
      </p>
      <GroundingReferences references={references.filter((reference) => used.has(reference.id))} />
    </div>
  );
}

function DeterministicView({
  result,
  references,
}: {
  result: DeterministicResult;
  references: DiscussionReference[];
}) {
  if (result.insufficientEvidence) {
    return (
      <div className="notice notice-info">
        The indexed material is insufficient to answer this question. No matching claims were found
        across accepted reviews.
      </div>
    );
  }
  return (
    <div>
      <p className="muted">
        {result.matchedClaimCount} claim(s) across {result.reviewsCovered.length} review(s).
      </p>
      {result.groups.map((group) => (
        <div key={group.relationType} style={{ marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "1.05rem" }}>{group.relationType.replace(/-/g, " ")}</h3>
          {group.claims.map((claim) => (
            <div className="claim-card" key={`${claim.reviewSlug}-${claim.claimId}`}>
              <p className="claim-text">{claim.text}</p>
              <p className="muted" style={{ margin: 0 }}>
                from{" "}
                <a
                  href={`/claims/${claim.reviewVersionId}/${encodeURIComponent(claim.localClaimId)}`}
                >
                  {claim.reviewTitle}
                </a>
                {trustSummary(claim)}
              </p>
            </div>
          ))}
        </div>
      ))}
      <div className="notice notice-info">
        {result.notes.map((n, i) => (
          <p key={i} style={{ margin: 0 }}>
            {n}
          </p>
        ))}
      </div>
      <GroundingReferences references={references} />
    </div>
  );
}

function GroundingReferences({ references }: { references: DiscussionReference[] }) {
  if (references.length === 0) return null;
  return (
    <div>
      <h3 style={{ fontSize: "1.05rem" }}>Grounding references</h3>
      <ul>
        {references.map((reference) => (
          <li key={`${reference.kind}:${reference.id}`}>
            <a href={reference.href}>{reference.label}</a>{" "}
            <span className="muted">({reference.kind})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function trustSummary(claim: EvidenceClaim): string {
  const states = new Set(
    claim.relations.flatMap((relation) =>
      relation.trust ? [relation.trust.verificationState] : [],
    ),
  );
  if (states.has("platform-verified")) return " · Atlas-reviewed TRUST structure";
  if (states.has("stale-verification")) return " · Atlas TRUST verification is stale";
  if (states.has("legacy-unknown")) return " · legacy TRUST provenance unknown";
  if (states.has("unverified-import")) return " · repository TRUST assertion (unverified)";
  return "";
}

function List({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <strong>{title}</strong>
      <ul>
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </>
  );
}
