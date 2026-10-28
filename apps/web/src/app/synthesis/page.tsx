import Link from "next/link";
import { type Metadata } from "next";
import { Badge, Card, Notice } from "@oratlas/ui";
import { getContradictionMap, type ContradictionMapRow } from "@/lib/synthesis";
import { SpecialistToolBreadcrumb } from "@/components/SpecialistTools";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Disagreement map" };

const KIND_LABEL: Record<ContradictionMapRow["kind"], string> = {
  "genuine-contradiction": "Candidate disagreement (no differing declared scope fields)",
  "scope-difference": "Scope difference",
  "undetermined-scope": "Candidate disagreement (scope undeclared)",
};

const KIND_TONE: Record<ContradictionMapRow["kind"], "warning" | "info" | "neutral"> = {
  "genuine-contradiction": "warning",
  "scope-difference": "info",
  "undetermined-scope": "neutral",
};

/**
 * Cross-review disagreement map. Every classification is a deterministic
 * rule over declared identifiers and stored relations — distinguishing
 * candidate disagreements from declared scope differences. Source grouping
 * does not establish evidence independence (ORATLAS_DECISIONS.md §8).
 */
export default async function SynthesisPage() {
  const map = await getContradictionMap();

  return (
    <article>
      <SpecialistToolBreadcrumb current="Disagreement map" />
      <h1>Disagreement map</h1>
      <p className="muted">
        Comparing {map.statementCount} claims across {map.reviewCount} accepted reviews. Counts and
        classifications describe recorded source overlap: shared work identifiers, declared dataset
        or cohort accessions, and declared derivation links group works together. Candidate pairs
        have opposing recorded evidence directions within a shared group. These rules establish
        neither evidence independence nor a scientific contradiction.
      </p>

      <div className="btn-row" style={{ marginBottom: "0.6rem" }}>
        <Badge tone="warning">
          {map.counts["genuine-contradiction"]} candidates with no differing declared scope fields
        </Badge>
        <Badge tone="neutral">{map.counts["scope-difference"]} scope differences</Badge>
        <Badge tone="neutral">{map.counts["undetermined-scope"]} scope undeclared</Badge>
      </div>
      <p className="muted" style={{ fontSize: "0.9rem" }}>
        Comparison is over the current version of each review.
      </p>

      {map.contradictions.length === 0 ? (
        <Card>
          <p className="muted">
            No candidate pairs were detected by these rules across the current accepted reviews.
          </p>
        </Card>
      ) : (
        map.contradictions.map((row, index) => (
          <Card as="article" key={index}>
            <div className="btn-row" style={{ marginBottom: "0.3rem" }}>
              <Badge tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</Badge>
              {row.kind !== "scope-difference" ? (
                <span className="muted">
                  {row.sharedFamilyCount} shared source-overlap group
                  {row.sharedFamilyCount === 1 ? "" : "s"}
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
        A scope difference means the recorded evidence directions oppose each other, but the claims
        declare different populations, models, interventions, outcomes or methods. They may answer
        different questions. Only scope fields declared by both claims are compared; missing fields
        remain unknown. Missing overlap metadata does not establish independence. Authorship and
        laboratory overlap are not assessed here, and dataset and derivation declarations may be
        incomplete. Inspect each exact claim and its sources before drawing a scientific conclusion.
      </Notice>
    </article>
  );
}
