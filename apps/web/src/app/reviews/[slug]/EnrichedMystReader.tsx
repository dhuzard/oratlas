"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ThemeProvider, type NodeRenderers } from "@myst-theme/providers";
import { DEFAULT_RENDERERS, MyST } from "myst-to-react";
import {
  COMMENT_BODY_MAX,
  COMMENT_KINDS,
  type CommentKind,
  type PassageCommentAnchor,
  type ReviewCommentList,
} from "@oratlas/contracts";
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

type CommentNode = ReviewCommentList["comments"][number];

interface SelectedPassage {
  anchor: PassageCommentAnchor;
  x: number;
  y: number;
}

const KIND_LABELS: Record<CommentKind, string> = {
  comment: "Comment",
  question: "Question",
  concern: "Concern",
  suggestion: "Suggestion",
  endorsement: "Endorsement",
};

function selectionFrom(container: HTMLElement, sourceSha256: string, documentPath: string) {
  const selection = globalThis.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.startContainer) || !container.contains(range.endContainer)) {
    return null;
  }
  const renderedText = container.textContent ?? "";
  const before = range.cloneRange();
  before.selectNodeContents(container);
  before.setEnd(range.startContainer, range.startOffset);
  const rawExact = range.toString();
  const leading = rawExact.length - rawExact.trimStart().length;
  const exact = rawExact.trim();
  if (!exact || exact.length > 2_000) return null;
  const start = before.toString().length + leading;
  const end = start + exact.length;
  const element =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  const astNodeId =
    element?.closest<HTMLElement>("[data-mdast-node-id], [id]")?.dataset.mdastNodeId ??
    element?.closest<HTMLElement>("[id]")?.id;
  const rect = range.getBoundingClientRect();
  return {
    anchor: {
      schemaVersion: "1.0.0" as const,
      representation: "myst-rendered-text-v1" as const,
      documentPath,
      sourceSha256,
      ...(astNodeId ? { astNodeId } : {}),
      textQuote: {
        type: "TextQuoteSelector" as const,
        exact,
        prefix: renderedText.slice(Math.max(0, start - 96), start),
        suffix: renderedText.slice(end, end + 96),
      },
      textPosition: { type: "TextPositionSelector" as const, start, end },
    },
    x: Math.min(globalThis.innerWidth - 170, Math.max(12, rect.left + rect.width / 2 - 70)),
    y: Math.max(12, rect.top - 46),
  };
}

function findQuoteOffset(text: string, anchor: PassageCommentAnchor): number {
  const expected = anchor.textPosition.start;
  if (text.slice(expected, expected + anchor.textQuote.exact.length) === anchor.textQuote.exact) {
    return expected;
  }
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  let cursor = text.indexOf(anchor.textQuote.exact);
  while (cursor >= 0) {
    const prefixMatches =
      !anchor.textQuote.prefix || text.slice(0, cursor).endsWith(anchor.textQuote.prefix);
    const suffixStart = cursor + anchor.textQuote.exact.length;
    const suffixMatches =
      !anchor.textQuote.suffix || text.slice(suffixStart).startsWith(anchor.textQuote.suffix);
    const distance =
      Math.abs(cursor - expected) + (prefixMatches ? 0 : 10_000) + (suffixMatches ? 0 : 10_000);
    if (distance < bestDistance) {
      best = cursor;
      bestDistance = distance;
    }
    cursor = text.indexOf(anchor.textQuote.exact, cursor + 1);
  }
  return best;
}

function domPointAt(container: HTMLElement, offset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let current = walker.nextNode() as Text | null;
  while (current) {
    if (remaining <= current.data.length) return { node: current, offset: remaining };
    remaining -= current.data.length;
    current = walker.nextNode() as Text | null;
  }
  return null;
}

function PassageComposer({
  passage,
  reviewSlug,
  canComment,
  onClose,
}: {
  passage: PassageCommentAnchor;
  reviewSlug: string;
  canComment: boolean;
  onClose(): void;
}) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<CommentKind>("comment");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/reviews/${encodeURIComponent(reviewSlug)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, kind, anchor: passage }),
      });
      const result = await response.json();
      if (!response.ok) {
        setError(result?.error?.message ?? "Could not post the passage comment.");
        return;
      }
      onClose();
      globalThis.getSelection()?.removeAllRanges();
      router.refresh();
    } catch {
      setError("Network error — the passage comment was not posted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="passage-composer">
      <div className="source-trust-inspector-heading">
        <div>
          <p className="review-eyebrow">Selected passage</p>
          <h3>Add to the discussion</h3>
        </div>
        <button className="btn btn-secondary" type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <blockquote>{passage.textQuote.exact}</blockquote>
      {canComment ? (
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="passage-comment-kind">Type</label>
            <select
              id="passage-comment-kind"
              value={kind}
              onChange={(event) => setKind(event.target.value as CommentKind)}
            >
              {COMMENT_KINDS.map((value) => (
                <option key={value} value={value}>
                  {KIND_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="passage-comment-body">Your comment</label>
            <textarea
              id="passage-comment-body"
              maxLength={COMMENT_BODY_MAX}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Explain the question, concern, or suggested improvement…"
            />
          </div>
          <button className="btn" type="submit" disabled={busy || !body.trim()}>
            {busy ? "Posting…" : "Post on this passage"}
          </button>
          {error ? <p className="notice notice-error">{error}</p> : null}
        </form>
      ) : (
        <p className="notice notice-info">
          <Link href="/signin">Sign in</Link> to comment on this exact passage.
        </p>
      )}
    </div>
  );
}

export function EnrichedMystReader({
  document,
  reviewSlug,
  reviewVersionId,
  comments,
  canComment,
  discussionEnabled,
  initialPagePath,
}: {
  document: ArticleDocument;
  reviewSlug: string;
  reviewVersionId: string;
  comments: ReviewCommentList["comments"];
  canComment: boolean;
  discussionEnabled: boolean;
  initialPagePath?: string;
}) {
  const [activePath, setActivePath] = useState(
    document.pages.some((page) => page.path === initialPagePath)
      ? initialPagePath!
      : (document.pages[0]?.path ?? ""),
  );
  const [selectedTrust, setSelectedTrust] = useState<SourceTrustClaim | null>(null);
  const [selectionAction, setSelectionAction] = useState<SelectedPassage | null>(null);
  const [draftPassage, setDraftPassage] = useState<PassageCommentAnchor | null>(null);
  const articleBody = useRef<HTMLDivElement>(null);
  const page =
    document.pages.find((candidate) => candidate.path === activePath) ?? document.pages[0];
  const passageComments = useMemo(
    () =>
      comments.filter(
        (comment) => comment.status === "visible" && comment.anchor?.documentPath === page?.path,
      ),
    [comments, page?.path],
  );
  const state = useMemo<ReaderState>(
    () => ({
      openPage(path) {
        if (document.pages.some((candidate) => candidate.path === path)) {
          setActivePath(path);
          setSelectedTrust(null);
          setDraftPassage(null);
          setSelectionAction(null);
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

  useEffect(() => {
    const container = articleBody.current;
    const highlightRegistry = (
      globalThis.CSS as unknown as {
        highlights?: { set(name: string, value: unknown): void; delete(name: string): void };
      }
    )?.highlights;
    const HighlightConstructor = (
      globalThis as unknown as {
        Highlight?: new (...ranges: Range[]) => unknown;
      }
    ).Highlight;
    if (!container || !highlightRegistry || !HighlightConstructor) return;
    const text = container.textContent ?? "";
    const ranges = passageComments.flatMap((comment) => {
      if (!comment.anchor) return [];
      const startOffset = findQuoteOffset(text, comment.anchor);
      if (startOffset < 0) return [];
      const start = domPointAt(container, startOffset);
      const end = domPointAt(container, startOffset + comment.anchor.textQuote.exact.length);
      if (!start || !end) return [];
      const range = globalThis.document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      return [range];
    });
    if (ranges.length > 0)
      highlightRegistry.set("oratlas-comments", new HighlightConstructor(...ranges));
    return () => highlightRegistry.delete("oratlas-comments");
  }, [passageComments, page?.path]);

  if (!page) return null;
  const activePage = page;

  function captureSelection() {
    if (!discussionEnabled || !articleBody.current) return;
    const selected = selectionFrom(articleBody.current, activePage.sha256, activePage.path);
    setSelectionAction(selected);
  }

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
            <div
              ref={articleBody}
              className="myst-selectable-body"
              onMouseUp={captureSelection}
              onKeyUp={captureSelection}
            >
              <MyST ast={page.ast} />
            </div>
          </article>

          <aside className="myst-context-panel" aria-label="Article context">
            {draftPassage ? (
              <PassageComposer
                passage={draftPassage}
                reviewSlug={reviewSlug}
                canComment={canComment}
                onClose={() => setDraftPassage(null)}
              />
            ) : selectedTrust ? (
              <TrustInspector claim={selectedTrust} onClose={() => setSelectedTrust(null)} />
            ) : (
              <div>
                <p className="review-eyebrow">Context</p>
                <h3>
                  {page.trustClaims.length} TRUST claims · {passageComments.length} passage comment
                  {passageComments.length === 1 ? "" : "s"}
                </h3>
                <p className="muted">
                  Select text to start a passage discussion, or select a TRUST marker to inspect its
                  score, rubric components and source provenance.
                </p>
                {passageComments.length > 0 ? (
                  <div className="passage-comment-summary">
                    <h4>Discussed passages</h4>
                    {passageComments.map((comment: CommentNode) => (
                      <a href="#community-review" key={comment.id}>
                        “{comment.anchor?.textQuote.exact.slice(0, 100)}
                        {(comment.anchor?.textQuote.exact.length ?? 0) > 100 ? "…" : ""}”
                        <span>{1 + comment.replies.length} contribution(s)</span>
                      </a>
                    ))}
                  </div>
                ) : null}
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
                <p className="myst-agent-link">
                  <Link
                    href={`/api/reviews/${encodeURIComponent(reviewSlug)}/versions/${encodeURIComponent(reviewVersionId)}/annotations`}
                  >
                    Machine-readable annotations (JSON-LD)
                  </Link>
                </p>
              </div>
            )}
          </aside>
        </div>
        {selectionAction ? (
          <button
            type="button"
            className="passage-comment-trigger"
            style={{ left: selectionAction.x, top: selectionAction.y }}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setDraftPassage(selectionAction.anchor);
              setSelectionAction(null);
              setSelectedTrust(null);
            }}
          >
            Comment on passage
          </button>
        ) : null}
      </ThemeProvider>
    </ReaderContext.Provider>
  );
}
