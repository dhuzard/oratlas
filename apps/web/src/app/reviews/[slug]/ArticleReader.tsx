import { Card, Badge } from "@oratlas/ui";
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
}: {
  document: ArticleDocument;
  claims: AnchoredClaim[];
}) {
  return (
    <Card title="Preserved scholarly article">
      <p className="muted">
        Read from the accepted database snapshot, never from the mutable upstream repository.
        Repository HTML is never executed. Source <span className="mono">{document.path}</span> ·
        SHA-256 <span className="mono">{document.sha256}</span>
      </p>
      {document.toc.length > 0 ? (
        <nav aria-label="Article table of contents">
          <h3>Contents</h3>
          <ol>
            {document.toc.map((entry) => (
              <li key={entry.id} style={{ marginLeft: `${Math.max(entry.level - 1, 0)}rem` }}>
                <a href={`#${entry.id}`}>{entry.text}</a>
              </li>
            ))}
          </ol>
        </nav>
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
            <div className="claim-card" id={claim.anchor} key={claim.anchor}>
              <p className="claim-text">{claim.text}</p>
              <div className="btn-row">
                <Badge>{claim.localClaimId}</Badge>
                {claim.section ? <span className="muted">§ {claim.section}</span> : null}
                <a href={`#${claim.anchor}-evidence`}>Evidence and discussion</a>
              </div>
            </div>
          ))}
        </section>
      ) : null}
    </Card>
  );
}
