import Link from "next/link";
import type { Metadata } from "next";
import { Badge, Card, Notice } from "@oratlas/ui";

export const metadata: Metadata = { title: "Public source pilot · read-only observations" };

const examples = [
  {
    name: "CRT · Ethical Debt",
    repository: "dhuzard/ethical-debt-AI-review",
    commit: "8170221a6ae90975de3c31540e278f8df96ee524",
    status: "Partial inspection",
    counts: "529 claims · 994 citations · 1392 source-declared evidence relations",
    assessments: "1392 source-native Computational Review TRUST v2 records",
    limitation:
      "Several fetch warnings and an oversized claim graph limit this current-head inspection. Deterministic acceptance tests use the separately frozen v0.1.0-trust-preview.3 release fixture, not this head.",
  },
  {
    name: "DiggyPaper · NTS animal use",
    repository: "dhuzard/nts-animal-use-review",
    commit: "b957ced01f0ff80fefcb08e5bebbdfe321383863",
    status: "Partial inspection",
    counts: "4 claims · 4 citations · 4 source-declared evidence relations",
    assessments: "0 TRUST records exposed",
    limitation:
      "Missing paths are invalid-test fixture files. The source-native lineage sidecar must be interpreted through its declared binding; a shared DOI alone does not bind evidence to a claim.",
  },
  {
    name: "Murmuration · HCM circadian mouse review",
    repository: "dhuzard/hcm-circadian-mouse-review",
    commit: "a906c5f15e77b8a4ac0671c9df15f75b8095029f",
    status: "Inspection completed without warnings",
    counts: "58 claims · 5 citations · 58 source-declared evidence relations",
    assessments: "0 TRUST records exposed",
    limitation:
      "The producer exporter is Neuronautix/murmuration. A completed report and evidence matrix are required; a configuration-only run does not provide these outputs. The report.md and traceability.md files remain upstream and were not captured or validated by this bounded inspection.",
  },
];

export default function PublicSourcePilotPage() {
  return (
    <article>
      <header className="page-hero">
        <p className="home-eyebrow">Sources · Read-only pilot</p>
        <h1>What three public source exports expose</h1>
        <p className="lead">
          Read-only observations from 29 October 2026, tied to the exact commits below. These are
          inspection results, not a live inventory of accepted ORAtlas records.
        </p>
        <Link href="/publications#add-source">Return to supported source paths</Link>
      </header>

      <Notice tone="info" title="Inspection, acceptance and graph records are separate">
        Inspection reports the source material captured and its structural coverage. An editor
        separately decides archive acceptance. Canonical materialization creates graph records
        through the supported editorial workflow; inspection alone does neither. Structural checks
        do not establish scientific correctness, peer review or certification.
      </Notice>

      <section aria-labelledby="pilot-examples-title">
        <h2 id="pilot-examples-title">Exact inspected sources</h2>
        <p>
          Counts describe exposed assertions, citations and source-declared relations. They do not
          measure evidence strength or independent corroboration. Missing material is a coverage
          gap.
        </p>
        {examples.map((example) => (
          <Card as="section" key={example.repository}>
            <Badge>{example.status}</Badge>
            <h3>{example.name}</h3>
            <p>{example.counts}</p>
            <p>{example.assessments}</p>
            <p>{example.limitation}</p>
            <p>
              <a href={`https://github.com/${example.repository}/tree/${example.commit}`}>
                Upstream source context · {example.repository}
              </a>
              <br />
              Exact commit: <code style={{ overflowWrap: "anywhere" }}>{example.commit}</code>
            </p>
          </Card>
        ))}
        <p className="muted">
          Upstream links identify public repository context, not preserved ORAtlas source records.
          Preserved context and exact claim links become available only where the corresponding
          records exist. Computational Review TRUST v2 remains producer-native; it is not ORAtlas
          TRUST or standalone TRUST.md, and no scoring crosswalk is implied. Zero exposed TRUST
          records means unavailable here, not untrustworthy.
        </p>
      </section>

      <section aria-labelledby="pilot-relations-title">
        <h2 id="pilot-relations-title">No established cross-source scientific relationship</h2>
        <p>
          The citation DOI sets in these three inspected exports have no overlap. This observation
          establishes neither independence nor scientific confirmation or contradiction. Source
          evidence relations remain attributed source assertions; any cross-source proposed relation
          must remain separate from an editor-confirmed relation.
        </p>
        <p>
          The CRT manifest declares Damien Huzard with ORCID 0000-0003-4820-7951. That declaration
          is not verified identifier ownership, authorship proof, account authority or a reason to
          merge identities across sources.
        </p>
      </section>

      <section aria-labelledby="pilot-next-title">
        <h2 id="pilot-next-title">Inspect a supported repository</h2>
        <p>
          Sign in and choose a supported source version in the existing deposit workflow to create a
          new inspection. Its captured commit and warnings may differ from these dated observations.
          Review the capture before submitting it for an editorial decision.
        </p>
        <div className="btn-row">
          <Link href="/submit">Inspect and deposit a repository</Link>
          <Link href="/compare">Compare available public claim records</Link>
        </div>
      </section>
    </article>
  );
}
