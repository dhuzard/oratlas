import Link from "next/link";
import { Badge } from "@oratlas/ui";
import { type ArticleDocument } from "@/lib/article-reader";
import { EnrichedMystReader } from "./EnrichedMystReader";

interface AnchoredClaim {
  anchor: string;
  localClaimId: string;
  text: string;
  section?: string;
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
            document structure. {document.pages.length} preserved page
            {document.pages.length === 1 ? "" : "s"} · {document.sourceTrustCount} source TRUST
            annotation{document.sourceTrustCount === 1 ? "" : "s"} · rendering{" "}
            <span className="mono">{document.rendering}</span>
          </p>
        </details>
      </header>
      <EnrichedMystReader document={document} />
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
