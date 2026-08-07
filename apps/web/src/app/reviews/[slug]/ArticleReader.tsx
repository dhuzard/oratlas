import Link from "next/link";
import { Badge } from "@oratlas/ui";
import { type ArticleBlock, type ArticleDocument } from "@/lib/article-reader";

interface AnchoredClaim {
  anchor: string;
  localClaimId: string;
  text: string;
  section?: string;
}

function Heading({ block }: { block: Extract<ArticleBlock, { kind: "heading" }> }) {
  const props = { id: block.id, children: block.text };
  switch (block.level) {
    case 1:
      return <h2 {...props} />;
    case 2:
      return <h3 {...props} />;
    case 3:
      return <h4 {...props} />;
    case 4:
      return <h5 {...props} />;
    default:
      return <h6 {...props} />;
  }
}

export function ArticleReader({
  document,
  claims,
  reviewSlug,
  discussionEnabled = true,
}: {
  document: ArticleDocument;
  claims: AnchoredClaim[];
  reviewSlug: string;
  discussionEnabled?: boolean;
}) {
  return (
    <section className="review-reader" aria-labelledby="preserved-review-title">
      <header className="review-reader-header">
        <p className="review-eyebrow">Preserved article</p>
        <h2 id="preserved-review-title">Read the review</h2>
        <p>
          This is the immutable article captured with the accepted review version. Claims and
          discussion remain linked to their exact record.
        </p>
        <details className="review-reader-source">
          <summary>Snapshot and rendering details</summary>
          <p className="muted">
            Read from the accepted database snapshot, never from the mutable upstream repository.
            Repository HTML and MyST plugins are never executed. ORAtlas safely renders the captured
            document structure. Source <span className="mono">{document.path}</span> · SHA-256{" "}
            <span className="mono">{document.sha256}</span>
          </p>
        </details>
      </header>
      {document.toc.length > 0 ? (
        <details className="review-reader-toc" open>
          <summary>Contents</summary>
          <nav aria-label="Article table of contents">
            <ol>
              {document.toc.map((entry) => (
                <li key={entry.id} style={{ marginLeft: `${Math.max(entry.level - 1, 0)}rem` }}>
                  <a href={`#${entry.id}`}>{entry.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        </details>
      ) : null}
      <div className="prose preserved-article">
        {document.blocks.map((block, index) => {
          if (block.kind === "heading") return <Heading block={block} key={block.id} />;
          if (block.kind === "paragraph") return <p key={index}>{block.text}</p>;
          if (block.kind === "code") {
            return (
              <pre key={index}>
                <code>{block.text}</code>
              </pre>
            );
          }
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{item}</li>
              ))}
            </List>
          );
        })}
      </div>
      {claims.length > 0 ? (
        <section aria-labelledby="atlas-claim-index">
          <h3 id="atlas-claim-index">Atlas claim anchors</h3>
          <p className="muted">
            Platform-owned anchors remain exact and stable even when repository headings change.
          </p>
          {claims.map((claim) => (
            <div className="claim-card article-claim-marker" id={claim.anchor} key={claim.anchor}>
              <p className="claim-text">{claim.text}</p>
              <div className="btn-row">
                <Badge>{claim.localClaimId}</Badge>
                {claim.section ? <span className="muted">§ {claim.section}</span> : null}
                <a href={`#${claim.anchor}-evidence`}>Evidence and discussion</a>
                {discussionEnabled ? (
                  <Link
                    href={`/reviews/${encodeURIComponent(reviewSlug)}?commentOn=${encodeURIComponent(claim.localClaimId)}#community-review`}
                  >
                    Comment on this claim
                  </Link>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </section>
  );
}
