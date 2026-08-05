"use client";
import { useState } from "react";
import type { DiscussionTraversalScope } from "@oratlas/contracts";
import { trustVerificationPresentation } from "@/components/TrustVerificationBadge";

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
    trustAssessments?: Array<{
      reviewStatus: string;
      verificationState:
        "platform-verified" | "unverified-import" | "stale-verification" | "legacy-unknown";
      notableCriteria: string[];
    }>;
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
  scope: {
    kind: "archive" | "review" | "explore";
    label: string;
    claimIds: string[];
    landscapeNodeIds: string[];
  };
}

interface DiscussionReference {
  kind: "claim" | "citation";
  id: string;
  label: string;
  href: string;
  landscapeNodeId: string;
}

export function DiscussClient({
  initialQuestion = "",
  scope,
  embedded = false,
}: {
  initialQuestion?: string;
  scope: DiscussionTraversalScope;
  embedded?: boolean;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<DiscussResponse | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "openai">("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");

  async function ask() {
    // A new answer has no selected grounding path yet. Clear any highlight from
    // the previous answer before the request so failures cannot leave stale graph state.
    highlightLandscape([]);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/discuss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          scope,
          llm: apiKey.trim()
            ? {
                provider,
                apiKey: apiKey.trim(),
                model: model.trim() || undefined,
              }
            : undefined,
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
      setApiKey("");
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
      <div className={embedded ? "atlas-discuss-composer" : "card"}>
        <div className="atlas-discuss-scope" aria-label="Atlas Discuss evidence scope">
          <strong>Visible evidence scope</strong>
          <span>{describeScope(scope)}</span>
          <small>
            Atlas will use only these signed, exact node versions and visible edges. Change the
            Explore path to edit the scope.
          </small>
        </div>
        <div className="field">
          <label htmlFor="atlas-question">Your question</label>
          <textarea
            id="atlas-question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What is the evidence that hippocampal replay supports memory consolidation?"
          />
        </div>
        <details style={{ marginBottom: "1rem" }}>
          <summary>Use your own LLM key (optional)</summary>
          <div className="filters" style={{ marginTop: "0.75rem" }}>
            <div className="field">
              <label htmlFor="llm-provider">Provider</label>
              <select
                id="llm-provider"
                value={provider}
                onChange={(event) =>
                  setProvider(event.target.value === "openai" ? "openai" : "anthropic")
                }
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="llm-api-key">API key</label>
              <input
                id="llm-api-key"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                autoComplete="new-password"
                spellCheck={false}
                placeholder={provider === "anthropic" ? "sk-ant-…" : "sk-…"}
              />
            </div>
            <div className="field">
              <label htmlFor="llm-model">Model (optional)</label>
              <input
                id="llm-model"
                type="text"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                spellCheck={false}
                placeholder={provider === "anthropic" ? "claude-sonnet-5" : "gpt-5.6"}
              />
            </div>
          </div>
          <small>
            The key is sent once to ORAtlas over this request, used server-side for this answer,
            never stored by ORAtlas, and cleared from this form afterward. The selected provider
            receives the bounded evidence packet under your account.
          </small>
        </details>

        <button className="btn" onClick={ask} disabled={loading || question.trim().length < 3}>
          {loading ? "Thinking…" : "Ask question"}
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
              No LLM key was supplied and no server provider is configured. Atlas is showing the
              deterministic structured evidence summary; no generated prose was attempted.
            </div>
          ) : null}

          <p className="muted" style={{ fontSize: "0.85rem" }}>
            Evidence packet {response.packetSchemaVersion}:{" "}
            <code className="mono" data-testid="discussion-packet-hash">
              {response.packetHash}
            </code>
          </p>

          <p className="atlas-discuss-resolved-scope">
            <strong>Evidence used:</strong> {response.scope.label} ·{" "}
            {response.scope.claimIds.length} selected claim
            {response.scope.claimIds.length === 1 ? "" : "s"}.
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
    grounding: Array<{
      statement: string;
      evidenceEdges: Array<{ claimId: string; citationId: string }>;
    }>;
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
      <GroundedStatements statements={answer.grounding} references={references} />
      <p className="muted">
        Grounded in {answer.reviewClaimsUsed.length} claim(s) and {answer.citationsUsed.length}{" "}
        citation(s). Every claim–citation edge was validated against the evidence packet. This is
        structural grounding, not a finding that the claims are scientifically correct.
      </p>
      <GroundingReferences references={references.filter((reference) => used.has(reference.id))} />
    </div>
  );
}

function GroundedStatements({
  statements,
  references,
}: {
  statements: NonNullable<LlmResult["answer"]>["grounding"];
  references: DiscussionReference[];
}) {
  if (statements.length === 0) return null;
  const referenceById = new Map(references.map((reference) => [reference.id, reference]));
  return (
    <section aria-labelledby="grounded-statements-title">
      <h3 id="grounded-statements-title" style={{ fontSize: "1.05rem" }}>
        Inspect grounded statements
      </h3>
      <ol className="grounded-statements">
        {statements.map((statement, index) => {
          const nodeIds = [
            ...new Set(
              statement.evidenceEdges.flatMap((edge) =>
                [referenceById.get(edge.claimId), referenceById.get(edge.citationId)].flatMap(
                  (reference) => (reference ? [reference.landscapeNodeId] : []),
                ),
              ),
            ),
          ];
          return (
            <li key={`${index}:${statement.statement}`}>
              <button
                type="button"
                className="grounded-statement"
                onClick={() => highlightLandscape(nodeIds)}
              >
                {statement.statement}
              </button>
              <small>
                {statement.evidenceEdges.length} validated claim–citation edge
                {statement.evidenceEdges.length === 1 ? "" : "s"} · select to highlight
              </small>
            </li>
          );
        })}
      </ol>
    </section>
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
      (relation.trustAssessments ?? (relation.trust ? [relation.trust] : [])).map(
        (assessment) => assessment.verificationState,
      ),
    ),
  );
  if (states.size === 0) return "";
  if (states.size > 1) return " · Mixed TRUST verification states — not Atlas verified";
  return ` · ${trustVerificationPresentation([...states][0]!).label}`;
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

function highlightLandscape(nodeIds: string[]) {
  window.dispatchEvent(
    new CustomEvent("oratlas:grounding-focus", {
      detail: { nodeIds },
    }),
  );
}

function describeScope(scope: DiscussionTraversalScope): string {
  return `${scope.nodes.length} exact graph occurrence${scope.nodes.length === 1 ? "" : "s"} · ${scope.edgeIds.length} visible edge${scope.edgeIds.length === 1 ? "" : "s"}`;
}
