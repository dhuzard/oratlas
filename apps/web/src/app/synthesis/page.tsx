import Link from "next/link";
import { type Metadata } from "next";
import { Badge, Card, Notice } from "@oratlas/ui";
import { getContradictionMap, type ContradictionMapRow } from "@/lib/synthesis";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contradiction map" };

const KIND_LABEL: Record<ContradictionMapRow["kind"], string> = {
  "genuine-contradiction": "Genuine contradiction",
  "scope-difference": "Scope difference",
  "undetermined-scope": "Contradiction (scope undeclared)",
};

const KIND_TONE: Record<ContradictionMapRow["kind"], "warning" | "info" | "neutral"> = {
  "genuine-contradiction": "warning",
  "scope-difference": "info",
  "undetermined-scope": "neutral",
};

/**
 * Cross-review contradiction map. Every classification is a deterministic
 * rule over declared identifiers and stored relations — distinguishing
 * genuine disagreement from a scope difference, and independent evidence from
 * repeated use of the same underlying source.
 */
export default async function SynthesisPage() {
  const map = await getContradictionMap();

  return (
    <article>
      <h1>Contradiction map</h1>
      <p className="muted">
        Comparing {map.statementCount} claims across {map.reviewCount} accepted reviews. Counts and
        classifications are rule-based: independent evidence is measured in evidence families (works
        sharing a dataset, cohort or derivative lineage collapse into one), and opposing claims with
        differing declared scope are separated from genuine contradictions.
      </p>

      <div className="btn-row" style={{ marginBottom: "0.6rem" }}>
        <Badge tone="warning">{map.counts["genuine-contradiction"]} genuine contradictions</Badge>
        <Badge tone="neutral">{map.counts["scope-difference"]} scope differences</Badge>
        <Badge tone="neutral">{map.counts["undetermined-scope"]} scope undeclared</Badge>
      </div>
      <p className="muted" style={{ fontSize: "0.9rem" }}>
        Comparison is over the current version of each review.
      </p>

      {map.contradictions.length === 0 ? (
        <Card>
          <p className="muted">
            No opposing claim pairs were detected across the current accepted reviews.
          </p>
        </Card>
      ) : (
        map.contradictions.map((row, index) => (
          <Card as="article" key={index}>
            <div className="btn-row" style={{ marginBottom: "0.3rem" }}>
              <Badge tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</Badge>
              {row.kind !== "scope-difference" ? (
                <span className="muted">
                  {row.sharedFamilyCount} shared evidence famil
                  {row.sharedFamilyCount === 1 ? "y" : "ies"}
                </span>
              ) : (
                <span className="muted">
                  differing scope: {row.differingScopeFields.join(", ")}
                </span>
              )}
            </div>
            <p>
              <Link href={row.a.passportPath}>{row.a.text}</Link>
            </p>
            <p className="muted" style={{ textAlign: "center" }}>
              vs
            </p>
            <p>
              <Link href={row.b.passportPath}>{row.b.text}</Link>
            </p>
          </Card>
        ))
      )}

      <Notice tone="info" title="How to read this">
        A scope difference means two claims point in opposite directions but declare different
        populations, models, interventions, outcomes or methods — they may answer different
        questions rather than disagree. Contradictions over independent evidence families are a
        stronger signal than repeated citations of a single shared source.
      </Notice>
    </article>
  );
}
