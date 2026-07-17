import Link from "next/link";
import { Badge, Card, DefinitionList, Notice, StatusPill } from "@oratlas/ui";
import {
  SYNTHESIS_PUBLIC_AI_LABEL,
  SYNTHESIS_PUBLIC_SCOPE_NOTICE,
  type PublicSynthesisReview,
  type SynthesisReviewParagraph,
} from "@oratlas/contracts";
import { serializeJsonForHtml } from "@/lib/json-for-html";
import {
  buildSynthesisJsonLd,
  type SynthesisCitationReadingContext,
  type SynthesisReadingContext,
} from "@/lib/synthesis-reading";

export function SynthesisReader({
  synthesis,
  reading,
  nonce,
}: {
  synthesis: PublicSynthesisReview;
  reading: SynthesisReadingContext;
  nonce?: string;
}) {
  const citationNumber = new Map<string, number>();
  for (const citation of synthesis.citations) {
    if (!citationNumber.has(citation.referenceId)) {
      citationNumber.set(citation.referenceId, citationNumber.size + 1);
    }
  }
  const generatedDate = formatDate(synthesis.provenance.generatedAt);

  return (
    <article className="synthesis-reader">
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{
          __html: serializeJsonForHtml(buildSynthesisJsonLd(synthesis)),
        }}
      />

      <header className="synthesis-masthead">
        <div className="btn-row synthesis-labels">
          <Badge tone="warning">{SYNTHESIS_PUBLIC_AI_LABEL}</Badge>
          <StatusPill status="editor-accepted" />
        </div>
        <h1>{synthesis.title}</h1>
        <p className="lead">{synthesis.abstract}</p>
        {synthesis.version.ordinal > 1 ? (
          <p>
            <Link href={`/reviews/${synthesis.slug}/changes`}>
              What changed since accepted version {synthesis.version.ordinal - 1}
            </Link>
          </p>
        ) : null}
      </header>

      <div className="synthesis-mobile-disclosure" aria-label="Persistent AI disclosure">
        <strong>{SYNTHESIS_PUBLIC_AI_LABEL}</strong>
        <span>
          {generatedDate} · {synthesis.provenance.provider}/{synthesis.provenance.model}
        </span>
        <span>
          {synthesis.provenance.pipelineSoftware.displayName} is the disclosed software agent.
          Editor {synthesis.provenance.approvingEditor.displayName} accepted this version and is
          accountable for the publication decision and checklist.
        </span>
        <span>Canonical scope: {SYNTHESIS_PUBLIC_SCOPE_NOTICE}</span>
        <span className="mono">packet {synthesis.provenance.packetHash}</span>
      </div>

      <div className="synthesis-layout">
        <aside className="synthesis-rail" aria-label="Article navigation and disclosure">
          <nav className="synthesis-toc" aria-labelledby="synthesis-toc-title">
            <h2 id="synthesis-toc-title">In this synthesis</h2>
            <ol>
              {synthesis.document.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
              <li>
                <a href="#grounding-citations">Grounding citations</a>
              </li>
              <li>
                <a href="#provenance-and-rights">Provenance and rights</a>
              </li>
            </ol>
          </nav>

          <section className="synthesis-disclosure" aria-labelledby="ai-disclosure-title">
            <h2 id="ai-disclosure-title">{SYNTHESIS_PUBLIC_AI_LABEL}</h2>
            <p>
              Generated {generatedDate} by {synthesis.provenance.pipelineSoftware.displayName} using{" "}
              <strong>
                {synthesis.provenance.provider}/{synthesis.provenance.model}
              </strong>
              .
            </p>
            <p>
              Editor <strong>{synthesis.provenance.approvingEditor.displayName}</strong> accepted
              this version for publication and is accountable for the editorial decision and
              checklist.
            </p>
            <span>{SYNTHESIS_PUBLIC_SCOPE_NOTICE}</span>
            <p className="synthesis-hash">
              Evidence packet SHA-256
              <br />
              <span className="mono">{synthesis.provenance.packetHash}</span>
            </p>
          </section>
        </aside>

        <div className="synthesis-content">
          <FreshnessNotice synthesis={synthesis} />

          {synthesis.document.sections.map((section) => {
            const disputed =
              section.id === "contradictions-and-open-questions" &&
              section.paragraphs.some((paragraph) =>
                paragraph.citations.some((citation) =>
                  reading.disputedReferenceIds.has(citation.referenceId),
                ),
              );
            const content = (
              <>
                <h2 id={section.id} tabIndex={-1}>
                  {section.title}
                </h2>
                {section.paragraphs.map((paragraph, index) => (
                  <SynthesisParagraph
                    key={index}
                    paragraph={paragraph}
                    contexts={reading.citations}
                    citationNumber={citationNumber}
                  />
                ))}
              </>
            );
            return (
              <section
                className={disputed ? "synthesis-section synthesis-disputed" : "synthesis-section"}
                key={section.id}
              >
                {content}
                {disputed ? (
                  <aside
                    className="synthesis-dispute-note"
                    aria-label="Disputed evidence"
                    role="note"
                  >
                    <p className="synthesis-callout-label">
                      <Badge tone="warning">Disputed</Badge> Confirmed contradiction in the cited
                      graph. Open the inline citations for exact immutable endpoints and provenance.
                    </p>
                  </aside>
                ) : null}
              </section>
            );
          })}

          <Card>
            <section id="grounding-citations" aria-labelledby="grounding-citations-title">
              <h2 id="grounding-citations-title">Grounding citations</h2>
              <ol className="synthesis-reference-list">
                {[...citationNumber].map(([referenceId, number]) => {
                  const citation = synthesis.citations.find(
                    (candidate) => candidate.referenceId === referenceId,
                  )!;
                  return (
                    <li key={referenceId}>
                      <Link href={citation.href}>{citation.title}</Link>{" "}
                      <Badge>{citation.nodeKind}</Badge>
                      {reading.disputedReferenceIds.has(referenceId) ? (
                        <>
                          {" "}
                          <Badge tone="warning">disputed</Badge>
                        </>
                      ) : null}
                      <span className="muted">
                        {" "}
                        [{number}] · {citation.location}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          </Card>

          <Card>
            <section id="provenance-and-rights" aria-labelledby="provenance-title">
              <h2 id="provenance-title">Provenance and rights</h2>
              <DefinitionList
                items={[
                  { term: "Generated", value: generatedDate },
                  {
                    term: "Accepted",
                    value: `${formatDate(synthesis.provenance.acceptedAt)} · version ${synthesis.version.ordinal}`,
                  },
                  {
                    term: "Software author",
                    value: `${synthesis.provenance.pipelineSoftware.displayName} ${synthesis.provenance.pipelineSoftware.pipelineVersion}`,
                  },
                  {
                    term: "Approving editor",
                    value: (
                      <a
                        href={`https://github.com/${synthesis.provenance.approvingEditor.githubLogin}`}
                      >
                        {synthesis.provenance.approvingEditor.displayName}
                      </a>
                    ),
                  },
                  {
                    term: "Model",
                    value: `${synthesis.provenance.provider}/${synthesis.provenance.model} (${synthesis.provenance.modelVersion})`,
                  },
                  { term: "License", value: synthesis.provenance.licenseSpdx },
                  { term: "Version DOI", value: <DoiValue value={synthesis.version.versionDoi} /> },
                  { term: "Concept DOI", value: <DoiValue value={synthesis.version.conceptDoi} /> },
                ]}
              />
              <p>{synthesis.provenance.rightsStatement}</p>
              <dl className="synthesis-digests">
                <div>
                  <dt>Evidence packet SHA-256</dt>
                  <dd className="mono">{synthesis.provenance.packetHash}</dd>
                </div>
                <div>
                  <dt>Document SHA-256</dt>
                  <dd className="mono">{synthesis.provenance.documentHash}</dd>
                </div>
              </dl>
            </section>
          </Card>
        </div>
      </div>
    </article>
  );
}

function SynthesisParagraph({
  paragraph,
  contexts,
  citationNumber,
}: {
  paragraph: SynthesisReviewParagraph;
  contexts: Map<string, SynthesisCitationReadingContext>;
  citationNumber: Map<string, number>;
}) {
  return (
    <div className="synthesis-paragraph-block">
      <p className="synthesis-paragraph">
        {paragraph.text}
        {paragraph.citations.length > 0 ? (
          <span className="synthesis-inline-citations" aria-label="Inline citations">
            {paragraph.citations.map((citation) => {
              const context = contexts.get(citation.referenceId)!;
              const number = citationNumber.get(citation.referenceId)!;
              return (
                <sup key={citation.referenceId}>
                  <Link
                    className="synthesis-inline-citation-link"
                    href={`/nodes/${context.nodeId}/versions/${context.nodeVersionId}`}
                    aria-label={`Citation ${number}: open exact ${context.nodeKind} evidence node`}
                  >
                    [{number}]
                  </Link>
                </sup>
              );
            })}
          </span>
        ) : null}
      </p>
      {paragraph.citations.length > 0 ? (
        <div className="synthesis-citation-disclosures" aria-label="Citation context">
          {paragraph.citations.map((citation, occurrenceIndex) => {
            const context = contexts.get(citation.referenceId)!;
            const number = citationNumber.get(citation.referenceId)!;
            return (
              <details
                className="synthesis-citation"
                key={`${citation.referenceId}:${occurrenceIndex}`}
              >
                <summary aria-label={`Citation ${number}: ${context.nodeKind} evidence details`}>
                  Citation [{number}] details
                </summary>
                <div className="synthesis-citation-panel">
                  <p>
                    <Badge>{context.nodeKind}</Badge>{" "}
                    <Link href={`/nodes/${context.nodeId}/versions/${context.nodeVersionId}`}>
                      Open exact evidence node
                    </Link>
                  </p>
                  <p className="muted">
                    {context.repository.owner}/{context.repository.name} ·{" "}
                    <span className="mono">{context.provenance.sourcePath}</span>
                    {context.provenance.sourcePointer
                      ? ` · ${context.provenance.sourcePointer}`
                      : ""}
                    {" · commit "}
                    <span className="mono">{context.provenance.commitSha.slice(0, 12)}</span>
                    {" · "}
                    {context.provenance.license}
                  </p>
                  <p className="muted">
                    TRUST is relation-scoped context, not a score for this node or a claim of truth.
                  </p>
                  {context.trust.length > 0 ? (
                    <ul aria-label="Relation-scoped TRUST context">
                      {context.trust.map((trust, index) => (
                        <li
                          key={`${trust.subject}:${trust.reviewStatus}:${trust.verificationState}:${index}`}
                        >
                          TRUST: {trust.subject} · {trust.reviewStatus.replace(/-/g, " ")} ·{" "}
                          {trust.verificationState.replace(/-/g, " ")}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No relation-scoped TRUST assessment is attached.</p>
                  )}
                  {context.disputes.length > 0 ? (
                    <p className="synthesis-citation-dispute">
                      <strong>Disputed:</strong> confirmed contradiction with{" "}
                      {context.disputes.map((dispute, index) => (
                        <span key={`${dispute.relatedNodeId}:${dispute.relatedNodeVersionId}`}>
                          {index > 0 ? ", " : ""}
                          <Link
                            href={`/nodes/${dispute.relatedNodeId}/versions/${dispute.relatedNodeVersionId}`}
                          >
                            {dispute.relatedTitle}
                          </Link>
                        </span>
                      ))}
                      .
                    </p>
                  ) : null}
                </div>
              </details>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FreshnessNotice({ synthesis }: { synthesis: PublicSynthesisReview }) {
  if (synthesis.freshness.status === "stale") {
    return (
      <Notice tone="warning" title="Newer evidence exists">
        A bounded freshness check found {synthesis.freshness.affectedReferenceCount} affected
        references. This accepted synthesis may not reflect the latest graph evidence.
      </Notice>
    );
  }
  return (
    <p>
      <Badge tone={synthesis.freshness.status === "fresh" ? "success" : "neutral"}>
        {synthesis.freshness.status === "fresh" ? "Freshness checked" : "Freshness not yet checked"}
      </Badge>
    </p>
  );
}

function DoiValue({ value }: { value?: string }) {
  return value ? (
    <a className="mono" href={`https://doi.org/${value}`} rel="noopener noreferrer">
      {value}
    </a>
  ) : (
    <span className="muted">—</span>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(new Date(value));
}
