import { useId } from "react";

export interface ExactSourceContextProps {
  kind: "Archived review" | "Repository research object" | "External publication";
  versionId: string;
  preservedHref: string;
  originalUrl?: string;
  originalLabel?: string;
  locator?: string;
  lifecycle: string;
  coverage: string[];
  identity?: Array<{ label: string; value: string }>;
  id?: string;
  title?: string;
}

/** Presentation only. Callers retain their source-specific loaders and visibility checks. */
export function ExactSourceContext({
  kind,
  versionId,
  preservedHref,
  originalUrl,
  originalLabel = "Open original source (may have changed)",
  locator,
  lifecycle,
  coverage,
  identity = [],
  id,
  title = "Exact source context",
}: ExactSourceContextProps) {
  const headingId = useId();
  return (
    <section id={id} className="card exact-source-context" aria-labelledby={headingId}>
      <h2 id={headingId}>{title}</h2>
      <dl className="exact-source-context-fields">
        <div>
          <dt>Source kind</dt>
          <dd>{kind}</dd>
        </div>
        <div>
          <dt>Exact version</dt>
          <dd>
            <code>{versionId}</code>
          </dd>
        </div>
        <div>
          <dt>Locator</dt>
          <dd>{locator || "No passage locator was recorded."}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>{lifecycle}</dd>
        </div>
        {identity.map(({ label, value }, index) => (
          <div key={`${label}:${index}`}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="btn-row">
        <a href={preservedHref}>Open preserved exact record</a>
        {originalUrl ? (
          <a href={originalUrl} rel="external">
            {originalLabel}
          </a>
        ) : null}
      </div>
      {originalUrl ? (
        <p className="muted">
          The original source address is separate from this preserved record. Publisher pages may
          have changed since capture.
        </p>
      ) : null}
      {coverage.length > 0 ? (
        <div className="exact-source-context-coverage">
          <h3>Available context and limits</h3>
          <ul>
            {coverage.map((limitation, index) => (
              <li key={index}>{limitation}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
