import Link from "next/link";
import { type Metadata } from "next";
import { Badge, Card, Notice } from "@oratlas/ui";

export const metadata: Metadata = {
  title: "Create and deposit an AI review",
  description:
    "Generate a critical review with the Allen computational-review workflow, then deposit an immutable version in Open Review Atlas.",
};

const TEMPLATE_URL = "https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate";

export default function CreateReviewPage() {
  return (
    <article className="create-review-page">
      <header className="page-hero">
        <p className="home-eyebrow">Author workflow</p>
        <h1>Create an AI review, then deposit it</h1>
        <p className="lead">
          The Allen computational-review pipeline creates and validates the review. ORAtlas does not
          generate it: ORAtlas captures an exact public version so people can find, read, discuss,
          challenge and compare it.
        </p>
        <div className="home-actions">
          <a className="btn" href={TEMPLATE_URL} rel="noopener noreferrer">
            Open the Allen review template
          </a>
          <Link className="btn btn-secondary" href="/submit">
            I already have a review
          </Link>
        </div>
      </header>

      <section className="responsibility-split" aria-labelledby="responsibility-title">
        <div className="home-section-intro">
          <p className="home-eyebrow">Two tools, one handoff</p>
          <h2 id="responsibility-title">Know where each step happens</h2>
        </div>
        <div className="comparison-columns">
          <Card title="Allen AIreview workflow">
            <Badge>creates the review</Badge>
            <ul>
              <li>Defines scope and gathers literature evidence.</li>
              <li>Drafts MyST content with separated writer and critic roles.</li>
              <li>Builds figures, bibliography, evidence and provenance artifacts.</li>
              <li>Runs citation, MyST, verification and deployment gates.</li>
            </ul>
          </Card>
          <Card title="Open Review Atlas">
            <Badge>archives the result</Badge>
            <ul>
              <li>Captures one exact public GitHub commit or release.</li>
              <li>Preserves the readable record and structured scientific objects.</li>
              <li>Exposes claims, citations, evidence relations and TRUST provenance.</li>
              <li>Keeps later comments and challenges separate from the source record.</li>
            </ul>
          </Card>
        </div>
      </section>

      <section aria-labelledby="author-steps-title" className="author-steps">
        <div className="home-section-intro">
          <p className="home-eyebrow">The big steps</p>
          <h2 id="author-steps-title">From a research question to an archived review</h2>
          <p>
            The upstream pipeline contains 21 gated phases. For a first deposit, think of them as
            five understandable stages.
          </p>
        </div>
        <ol className="workflow-steps">
          <li>
            <span className="home-principle-index" aria-hidden="true">
              01
            </span>
            <div>
              <h3>Create your repository</h3>
              <p>
                Use the Allen template to create a new GitHub repository, clone it, and set the
                title and description in <code>myst.yml</code>.
              </p>
            </div>
          </li>
          <li>
            <span className="home-principle-index" aria-hidden="true">
              02
            </span>
            <div>
              <h3>Define the scientific brief</h3>
              <p>
                Give the pipeline a precise title, table of contents, evidence-depth target and
                repository URL. Scope decisions determine the literature search and later gates.
              </p>
            </div>
          </li>
          <li>
            <span className="home-principle-index" aria-hidden="true">
              03
            </span>
            <div>
              <h3>Run evidence, drafting and criticism</h3>
              <p>
                The workflow gathers evidence, builds citation infrastructure, drafts sections, runs
                blinded criticism, integrates the argument and constructs figures.
              </p>
            </div>
          </li>
          <li>
            <span className="home-principle-index" aria-hidden="true">
              04
            </span>
            <div>
              <h3>Verify and publish the MyST site</h3>
              <p>
                Citation triples, supporting passages, MyST structure and deployment are checked.
                GitHub Actions builds the site and deploys it to GitHub Pages.
              </p>
            </div>
          </li>
          <li>
            <span className="home-principle-index" aria-hidden="true">
              05
            </span>
            <div>
              <h3>Pin and deposit in ORAtlas</h3>
              <p>
                Choose the public release or exact default-branch state you want archived. ORAtlas
                inspects it, shows compatibility findings, then creates an editorial submission.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section aria-labelledby="deposit-checklist-title" className="deposit-checklist">
        <div className="home-section-heading">
          <div>
            <p className="home-eyebrow">Before you deposit</p>
            <h2 id="deposit-checklist-title">A review that others can inspect</h2>
          </div>
          <Link href="/submit">Start deposit</Link>
        </div>
        <div className="comparison-columns">
          <Card title="Required for the handoff">
            <ul className="check-list">
              <li>A public GitHub repository and an attributable submitter.</li>
              <li>A successful, stable commit or release to capture.</li>
              <li>Readable review metadata and a license when one is actually declared.</li>
              <li>No secrets, private data or mutable-only dependencies in the deposit.</li>
            </ul>
          </Card>
          <Card title="Adds scientific value in ORAtlas">
            <ul className="check-list">
              <li>MyST review content and bibliography.</li>
              <li>Typed claim, citation and evidence-relation artifacts.</li>
              <li>TRUST records with protocol, assessor and review status.</li>
              <li>Exact provenance for data, code, figures and verification outputs.</li>
            </ul>
          </Card>
        </div>
      </section>

      <Notice tone="warning" title="Deposit is not peer review">
        The Allen pipeline’s gates are process and verification evidence. ORAtlas archive acceptance
        is an editorial curation decision. Neither establishes scientific correctness, consensus,
        independent replication, or blanket TRUST.
      </Notice>

      <Card title="Ready to share the result?">
        <p>
          ORAtlas first inspects the repository without creating a publication. You review the exact
          source selection and validation report before submitting it to the archive.
        </p>
        <div className="btn-row">
          <Link className="btn" href="/submit">
            Deposit a review
          </Link>
          <Link href="/archive">See deposited reviews</Link>
          <Link href="/compare">See what becomes comparable</Link>
        </div>
      </Card>
    </article>
  );
}
