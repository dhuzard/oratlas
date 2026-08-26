import Link from "next/link";
import { Badge } from "@oratlas/ui";
import { listPublicationVersionCertifications } from "@/lib/certification";
import { prisma } from "@/lib/db";
import { oraPilotPresentation } from "@/lib/ora-certification-presentation";
import { listPublicationVersionVerifications } from "@/lib/scientific-verification";

export const dynamic = "force-dynamic";

const DEMO_VERSION_ID = "ora-demo-publication-version";

export default async function HomePage() {
  const demo = await prisma.publicationVersion.findUnique({
    where: { id: DEMO_VERSION_ID },
    include: { publication: true },
  });
  const [verifications, certifications] = demo
    ? await Promise.all([
        listPublicationVersionVerifications(demo.id),
        listPublicationVersionCertifications(demo.id),
      ])
    : [null, null];
  const certification = certifications?.certifications[0];
  const demoHref = demo
    ? `/publications/${demo.publicationId}/versions/${demo.id}`
    : "/publications";

  return (
    <>
      <section className="home-hero" aria-labelledby="home-title">
        <p className="home-eyebrow">Scientific evidence ledger</p>
        <h1 id="home-title">Scientific publications that can be independently checked.</h1>
        <p className="lead">
          ORAtlas connects exact, versioned scientific publications to reproducible verification
          evidence, claims, discussions and independent certification. Statistics can be recomputed,
          analyses compared, figures checked and scientific assessments attached without altering
          the original publication.
        </p>
        <div className="home-actions home-primary-actions">
          <Link className="btn" href={demoHref}>
            {verifications && verifications.runs.length > 0
              ? "Explore a verified publication"
              : "Explore the demo publication"}
          </Link>
          <Link className="btn btn-secondary" href="/verification">
            See how verification works
          </Link>
        </div>
        <p className="home-note">
          Verification, certification and TRUST assessment are separate, attributable records. None
          is a universal quality score or a replacement for peer review.
        </p>
      </section>

      <section className="demo-publication" aria-labelledby="demo-publication-title">
        <div className="demo-publication-header">
          <div>
            <p className="home-eyebrow">Demonstration publication</p>
            <h2 id="demo-publication-title">
              {demo?.title ?? "Scientific verification demonstration"}
            </h2>
            <p className="muted">
              {demo ? `${demo.versionLabel ?? "Exact version"} · source captured` : "Demo record"}
            </p>
          </div>
          <Badge tone="warning">Demo / synthetic</Badge>
        </div>
        <p>
          This deliberately synthetic publication demonstrates the evidence workflow. It is not a
          real study or scientific endorsement.
        </p>
        <div className="demo-publication-grid">
          <div>
            <p className="demo-label">Published externally</p>
            <p>
              <strong>{demo?.adapterType === "myst" ? "MyST" : "Machine-readable source"}</strong>
              <br />
              Exact PublicationVersion captured by ORAtlas
            </p>
          </div>
          <div>
            <p className="demo-label">Scientific verification</p>
            {verifications && verifications.runs.length > 0 ? (
              <ul className="compact-list">
                {Object.entries(verifications.summary).map(([category, counts]) => (
                  <li key={category}>
                    <strong>{category}</strong>: {formatCounts(counts)}
                  </li>
                ))}
              </ul>
            ) : (
              <p>No completed verification findings are attached to this seed yet.</p>
            )}
          </div>
          <div>
            <p className="demo-label">Certification</p>
            {certification ? (
              <p>
                <Link href={`/certifications/${certification.id}`}>
                  <strong>
                    {oraPilotPresentation(certification)?.label ?? certification.certifier.name}
                  </strong>
                </Link>
                <br />
                {certification.protocol.title} · {certification.lifecycleState}
              </p>
            ) : (
              <p>No certification assertion is attached to this seed yet.</p>
            )}
          </div>
        </div>
        <div className="home-actions">
          {demo?.observedPublicationBaseUrl ? (
            <a className="btn btn-secondary" href={demo.observedPublicationBaseUrl} rel="external">
              Read external publication ↗
            </a>
          ) : null}
          <Link className="btn" href={demoHref}>
            Inspect the scientific record
          </Link>
        </div>
      </section>

      <section id="how-it-works" className="home-how" aria-labelledby="how-it-works-title">
        <div className="home-section-intro">
          <p className="home-eyebrow">How it works</p>
          <h2 id="how-it-works-title">
            The publication stays external. The evidence stays connected.
          </h2>
          <p>
            ORAtlas coordinates exact scientific identity and immutable evidence. Scientific
            calculations run in accountable external verifier services, not inside ORAtlas.
          </p>
        </div>
        <div className="evidence-flow" aria-label="ORAtlas evidence workflow">
          <article>
            <span className="home-principle-index">01</span>
            <h3>External publication</h3>
            <p>MyST today; other machine-readable adapters can follow.</p>
          </article>
          <span className="flow-arrow" aria-hidden="true">
            →
          </span>
          <article>
            <span className="home-principle-index">02</span>
            <h3>ORAtlas ledger</h3>
            <p>Exact version, content, claims, contributors and provenance.</p>
          </article>
          <span className="flow-arrow" aria-hidden="true">
            →
          </span>
          <article>
            <span className="home-principle-index">03</span>
            <h3>External verification</h3>
            <p>Protocol-scoped findings and artifacts returned over HTTP.</p>
          </article>
          <span className="flow-arrow" aria-hidden="true">
            →
          </span>
          <article>
            <span className="home-principle-index">04</span>
            <h3>Certification</h3>
            <p>An attributable synthesis of evidence under a versioned protocol.</p>
          </article>
        </div>
      </section>

      <section className="home-distinctions" aria-labelledby="record-types-title">
        <div className="home-section-intro">
          <p className="home-eyebrow">Three distinct records</p>
          <h2 id="record-types-title">Specific evidence, never one opaque score.</h2>
        </div>
        <div className="home-principles">
          <article>
            <span className="record-mark record-mark-verification">V</span>
            <h3>Verification</h3>
            <p>Did a specific, declared check succeed for this exact version?</p>
          </article>
          <article>
            <span className="record-mark record-mark-certification">C</span>
            <h3>Certification</h3>
            <p>What did an attributable certifier conclude under a named protocol?</p>
          </article>
          <article>
            <span className="record-mark record-mark-trust">T</span>
            <h3>TRUST assessment</h3>
            <p>What is assessed about a specific claim–evidence relationship?</p>
          </article>
        </div>
      </section>
    </>
  );
}

function formatCounts(counts: Record<string, number>) {
  return Object.entries(counts)
    .map(([status, count]) => `${count} ${status.replaceAll("-", " ")}`)
    .join(" · ");
}
