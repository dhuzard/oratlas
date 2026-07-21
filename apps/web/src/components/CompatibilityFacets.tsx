import type { FacetCompatibilityReport, FacetCompatibilityStatus } from "@oratlas/contracts";
import { Badge } from "@oratlas/ui";

const FACETS: Array<{ key: keyof FacetCompatibilityReport; label: string }> = [
  { key: "article", label: "Article / prose" },
  { key: "citations", label: "Citations / bibliography" },
  { key: "evidencePackage", label: "Evidence package" },
  { key: "claimGraph", label: "Claim graph" },
  { key: "assessments", label: "Assessments (TRUST)" },
];

const TONES: Record<FacetCompatibilityStatus, string> = {
  available: "success",
  partial: "warning",
  unavailable: "neutral",
  unknown: "warning",
};

/** Render only stored deterministic evidence; React escapes every evidence string. */
export function CompatibilityFacets({
  facets,
  legacyMessage = "Facet compatibility is unavailable for this immutable legacy report.",
}: {
  facets?: FacetCompatibilityReport;
  legacyMessage?: string;
}) {
  if (!facets) return <p className="muted">{legacyMessage}</p>;

  return (
    <dl className="def-list" aria-label="Compatibility by facet">
      {FACETS.map(({ key, label }) => {
        const value = facets[key];
        return (
          <div className="def-row" key={key} data-compatibility-facet={key}>
            <dt>{label}</dt>
            <dd>
              <Badge tone={TONES[value.status]}>{value.status}</Badge>
              <ul>
                {value.evidence.map((item, index) => (
                  <li className="muted" key={`${key}:${index}`}>
                    {item}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
