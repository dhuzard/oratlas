"use client";

import React, { createContext, useContext, useMemo, useState } from "react";
import { ThemeProvider, type NodeRenderers } from "@myst-theme/providers";
import { DEFAULT_RENDERERS, MyST } from "myst-to-react";
import type { ArticleDocument, MystNode, SourceTrustClaim } from "@/lib/article-reader";

interface ReaderState {
  openPage(path: string): void;
  inspectTrust(claim: SourceTrustClaim): void;
}

const ReaderContext = createContext<ReaderState | null>(null);

function nodeChildren(node: MystNode): MystNode[] {
  return Array.isArray(node.children) ? node.children : [];
}

function ArticleLink({ node, className }: { node: MystNode; className?: string }) {
  const reader = useContext(ReaderContext);
  const url = typeof node.url === "string" ? node.url : "#";
  const articlePagePath =
    typeof node.articlePagePath === "string" ? node.articlePagePath : undefined;
  if (articlePagePath && reader) {
    return (
      <button
        className={`myst-page-link ${className ?? ""}`.trim()}
        type="button"
        onClick={() => reader.openPage(articlePagePath)}
      >
        <MyST ast={nodeChildren(node)} />
      </button>
    );
  }
  const external = /^https?:/i.test(url);
  return (
    <a
      className={className}
      href={url}
      rel={external ? "noopener noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      <MyST ast={nodeChildren(node)} />
    </a>
  );
}

function TrustMarker({ node }: { node: MystNode }) {
  const reader = useContext(ReaderContext);
  const claim = node.trustClaim as SourceTrustClaim | undefined;
  if (!claim || !reader) return null;
  const label = claim.label?.replace(/_/g, " ");
  return (
    <button
      className="source-trust-marker"
      type="button"
      onClick={() => reader.inspectTrust(claim)}
      aria-label={`Inspect source TRUST assessment for ${claim.claimId}`}
    >
      <span>TRUST</span>
      {claim.overallScore !== undefined ? <strong>{claim.overallScore}</strong> : null}
      {label ? <small>{label}</small> : null}
    </button>
  );
}

function SafeImage({ node, className }: { node: MystNode; className?: string }) {
  const url = typeof node.url === "string" ? node.url : undefined;
  if (!url || !/^https:\/\//i.test(url)) return null;
  const alt = typeof node.alt === "string" ? node.alt : "";
  const title = typeof node.title === "string" ? node.title : undefined;
  return (
    <figure className={`myst-figure ${className ?? ""}`.trim()}>
      {/* Exact-commit repository asset; arbitrary repository scripts are never rendered. */}
      <img src={url} alt={alt} title={title} loading="lazy" decoding="async" />
      {title ? <figcaption>{title}</figcaption> : null}
    </figure>
  );
}

const renderers: NodeRenderers = {
  ...DEFAULT_RENDERERS,
  link: { base: ArticleLink },
  image: { base: SafeImage },
  trustClaimMarker: { base: TrustMarker },
};

function formatComponentName(name: string): string {
  return name.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function TrustInspector({ claim, onClose }: { claim: SourceTrustClaim; onClose(): void }) {
  return (
    <div className="source-trust-inspector">
      <div className="source-trust-inspector-heading">
        <div>
          <p className="review-eyebrow">Source assertion · TRUST {claim.protocolVersion ?? ""}</p>
          <h3>
            {claim.overallScore !== undefined ? `${claim.overallScore}/100` : "TRUST details"}
          </h3>
        </div>
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mono">{claim.claimId}</p>
      {claim.claimText ? <p>{claim.claimText}</p> : null}
      {claim.label ? <p className="source-trust-label">{claim.label.replace(/_/g, " ")}</p> : null}
      {claim.humanReviewRequired ? (
        <p className="source-trust-review-flag">Human review required</p>
      ) : null}
      {claim.components.length > 0 ? (
        <dl className="source-trust-components">
          {claim.components.map((component) => (
            <div key={component.name}>
              <dt>
                {formatComponentName(component.name)}
                {component.score !== undefined ? ` · ${component.score}/4` : ""}
              </dt>
              <dd>
                {component.rationale ?? "No source rationale supplied."}
                {component.ruleId ? <span className="mono"> Rule {component.ruleId}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="muted">The source supplied only a summary score for this claim.</p>
      )}
      {claim.capped ? (
        <p className="source-trust-review-flag">
          Score capped{claim.capReasons.length > 0 ? `: ${claim.capReasons.join("; ")}` : "."}
        </p>
      ) : null}
      <p className="muted">
        This is the publication’s own TRUST record. It is not an ORAtlas verification or a merged
        platform score.
      </p>
    </div>
  );
}

export function EnrichedMystReader({ document }: { document: ArticleDocument }) {
  const [activePath, setActivePath] = useState(document.pages[0]?.path ?? "");
  const [selectedTrust, setSelectedTrust] = useState<SourceTrustClaim | null>(null);
  const page =
    document.pages.find((candidate) => candidate.path === activePath) ?? document.pages[0];
  const state = useMemo<ReaderState>(
    () => ({
      openPage(path) {
        if (document.pages.some((candidate) => candidate.path === path)) {
          setActivePath(path);
          setSelectedTrust(null);
          requestAnimationFrame(() =>
            globalThis.document
              .getElementById("myst-active-page")
              ?.scrollIntoView({ behavior: "smooth" }),
          );
        }
      },
      inspectTrust(claim) {
        setSelectedTrust(claim);
      },
    }),
    [document.pages],
  );
  if (!page) return null;

  return (
    <ReaderContext.Provider value={state}>
      <ThemeProvider theme={null} setTheme={() => undefined} renderers={renderers}>
        <div className="myst-reader-layout">
          <aside className="myst-page-navigation" aria-label="Article pages">
            <p className="review-eyebrow">Article contents</p>
            <ol>
              {document.navigation.map((entry) => (
                <li key={entry.path} style={{ paddingLeft: `${entry.depth * 0.7}rem` }}>
                  <button
                    type="button"
                    aria-current={entry.path === page.path ? "page" : undefined}
                    onClick={() => state.openPage(entry.path)}
                  >
                    {entry.title}
                  </button>
                </li>
              ))}
            </ol>
          </aside>

          <article id="myst-active-page" className="prose preserved-article myst-article-page">
            <header className="myst-page-heading">
              <p className="review-eyebrow">{page.path}</p>
              <h2>{page.title}</h2>
              <p className="mono muted">SHA-256 {page.sha256}</p>
            </header>
            <MyST ast={page.ast} />
          </article>

          <aside className="myst-context-panel" aria-label="Article context">
            {selectedTrust ? (
              <TrustInspector claim={selectedTrust} onClose={() => setSelectedTrust(null)} />
            ) : (
              <div>
                <p className="review-eyebrow">Context</p>
                <h3>{page.trustClaims.length} source TRUST claims</h3>
                <p className="muted">
                  Select a TRUST marker in the article to inspect its score, rubric components and
                  source provenance.
                </p>
                {page.toc.length > 0 ? (
                  <nav aria-label="Sections on this page">
                    <h4>On this page</h4>
                    <ol>
                      {page.toc.map((entry) => (
                        <li
                          key={entry.id}
                          style={{ paddingLeft: `${Math.max(0, entry.level - 1) * 0.5}rem` }}
                        >
                          <a href={`#${entry.id}`}>{entry.text}</a>
                        </li>
                      ))}
                    </ol>
                  </nav>
                ) : null}
              </div>
            )}
          </aside>
        </div>
      </ThemeProvider>
    </ReaderContext.Provider>
  );
}
