import Link from "next/link";

export default function ClaimComparisonNotFound() {
  return (
    <article className="comparison-page">
      <header className="page-hero">
        <p className="home-eyebrow">Exact occurrence comparison</p>
        <h1>This claim pair is unavailable</h1>
        <p className="lead">
          Both references must identify public, exact claim occurrences. A reference may be
          incomplete, unsupported, or no longer public. No replacement claim was selected.
        </p>
      </header>
      <div className="btn-row">
        <Link href="/compare">Choose two exact claims</Link>
        <Link href="/explore">Find claims</Link>
      </div>
    </article>
  );
}
