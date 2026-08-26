import Link from "next/link";
import { Badge, Card } from "@oratlas/ui";

export default function ConnectPage() {
  return (
    <>
      <header className="page-hero">
        <p className="home-eyebrow">Developers</p>
        <h1>Connect a publication</h1>
        <p className="lead">
          Publish wherever you want. ORAtlas works with exact, machine-readable scientific versions
          through adapters that preserve content, claims, contributors and production provenance as
          separate dimensions.
        </p>
      </header>

      <div className="grid grid-2 adapter-grid">
        <Card title="MyST">
          <div className="btn-row">
            <Badge tone="success">Supported</Badge>
            <Badge>First adapter</Badge>
          </div>
          <p>
            Closed protocols 0.2.0 and 0.3.0 are supported. MyST is the first proof of portability,
            not the identity of ORAtlas.
          </p>
          <pre className="install-command">npm install @neuronautix/myst</pre>
          <p className="muted">
            Source/tag compatibility includes 0.3.0. Because the 0.3.0 GitHub release may still be a
            draft, confirm the currently published npm version before pinning install instructions.
          </p>
        </Card>
        <Card title="JATS and Quarto">
          <div className="btn-row">
            <Badge>Planned</Badge>
          </div>
          <p>
            Future adapters can produce the same format-neutral PublicationVersion boundary without
            changing verification, certification or graph identity.
          </p>
        </Card>
      </div>

      <section className="adapter-flow" aria-labelledby="adapter-flow-title">
        <p className="home-eyebrow">Current adapter flow</p>
        <h2 id="adapter-flow-title">MyST → ORAtlas, once</h2>
        <div className="adapter-flow-grid">
          <div>
            <strong>External MyST publication</strong>
            <code>lab.github.io/paper</code>
          </div>
          <div className="adapter-artifacts">
            <code>myst.xref.json</code>
            <code>oratlas.manifest.json</code>
            <code>claims</code>
          </div>
          <span className="flow-arrow" aria-hidden="true">
            →
          </span>
          <div>
            <strong>ORAtlas</strong>
            <span>Publication · exact version · content</span>
            <span>contributors · production provenance · claims</span>
          </div>
        </div>
      </section>

      <div className="home-actions">
        <Link className="btn" href="/api-docs">
          Read the API documentation
        </Link>
        <a
          className="btn btn-secondary"
          href="https://github.com/dhuzard/oratlas-myst"
          rel="external"
        >
          MyST adapter source ↗
        </a>
      </div>
    </>
  );
}
