import Link from "next/link";

export function ContextualRecordActions({
  sourceType,
  sourceHref,
  reference,
}: {
  sourceType: "review-version" | "publication-version";
  sourceHref: string;
  reference: string;
}) {
  return (
    <div className="contextual-record-actions">
      <h3>Respond in this exact context</h3>
      <p className="muted">
        Subject reference: <code>{reference}</code>
      </p>
      {sourceType === "review-version" ? (
        <>
          <ul>
            <li>
              <Link href={`${sourceHref}#community-review`}>Read discussion</Link>: informal
              questions and comments. Exact-version readers keep discussion read-only.
            </li>
            <li>
              <Link href={`${sourceHref}#formal-challenges`}>
                Choose a formal challenge subject
              </Link>
              : an attributed, immutable objection. Select the exact claim, citation, relation or
              criterion before filing.
            </li>
            <li>
              <Link href={`${sourceHref}#assessments`}>Inspect relation assessments</Link>: TRUST
              records concern an exact evidence relation under a named protocol.
            </li>
          </ul>
          <p className="muted">
            These links retain this source version. Available actions depend on the existing subject
            and your authorization; a comment or challenge does not confirm a relation.
          </p>
        </>
      ) : (
        <p>
          This external occurrence has no comment or challenge form here. Inspect its{" "}
          <Link href={sourceHref}>exact publication record</Link> and preserve the occurrence
          reference when reporting a concern. No review-specific action is substituted.
        </p>
      )}
      <p className="muted">
        Relation proposals require their existing scoped workflow and editorial confirmation.
        Comparing records does not create a proposal, assessment or decision.
      </p>
    </div>
  );
}
