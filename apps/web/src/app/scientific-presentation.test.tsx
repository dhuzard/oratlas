import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { synthesize, type SynthesisCitation, type SynthesisStatement } from "@oratlas/knowledge";

const state = vi.hoisted(() => ({
  demo: vi.fn(),
  verifications: vi.fn(),
  certifications: vi.fn(),
  passport: vi.fn(),
  overlap: vi.fn(),
  map: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ prisma: { publicationVersion: { findUnique: state.demo } } }));
vi.mock("@/lib/scientific-verification", () => ({
  listPublicationVersionVerifications: state.verifications,
}));
vi.mock("@/lib/certification", () => ({
  listPublicationVersionCertifications: state.certifications,
}));
vi.mock("@/lib/claim-monitoring", () => ({ getClaimPassport: state.passport }));
vi.mock("@/lib/synthesis", () => ({
  getClaimIndependence: state.overlap,
  getContradictionMap: state.map,
}));
vi.mock("@/components/SourceEvidenceLinksCard", () => ({ SourceEvidenceLinksCard: () => null }));

import HomePage from "./page";
import SynthesisPage from "./synthesis/page";
import ClaimPassportPage from "./claims/[versionId]/[localClaimId]/page";

function sharedSourceFixture(scope?: SynthesisStatement["scope"]) {
  const citations: SynthesisCitation[] = [
    {
      citationId: "a",
      doi: "10.5555/shared-a",
      datasetIds: ["GSE1234"],
      derivedFromDois: [],
      isExample: true,
    },
    {
      citationId: "b",
      doi: "10.5555/shared-b",
      datasetIds: ["GSE1234"],
      derivedFromDois: [],
      isExample: true,
    },
  ];
  const statements: SynthesisStatement[] = [
    {
      claimId: "claim-a",
      reviewSlug: "review-a",
      reviewVersionId: "version-a",
      localClaimId: "local-a",
      text: "Assertion A",
      scope: { population: "mice" },
      evidence: [
        { citationId: "a", relationType: "supports" },
        { citationId: "b", relationType: "supports" },
      ],
    },
    {
      claimId: "claim-b",
      reviewSlug: "review-b",
      reviewVersionId: "version-b",
      localClaimId: "local-b",
      text: "Assertion B",
      scope,
      evidence: [{ citationId: "a", relationType: "contradicts" }],
    },
  ];
  const result = synthesize(statements, citations);
  const contradictions = result.contradictions.map((row) => ({
    ...row,
    a: { claimId: "claim-a", text: "Assertion A", passportPath: "/claims/version-a/local-a" },
    b: { claimId: "claim-b", text: "Assertion B", passportPath: "/claims/version-b/local-b" },
  }));
  state.overlap.mockResolvedValue({ summary: result.statements[0]!.summary, contradictions });
  state.map.mockResolvedValue({
    statementCount: 2,
    reviewCount: 2,
    contradictions,
    counts: {
      "genuine-contradiction": Number(contradictions[0]!.kind === "genuine-contradiction"),
      "scope-difference": Number(contradictions[0]!.kind === "scope-difference"),
      "undetermined-scope": Number(contradictions[0]!.kind === "undetermined-scope"),
    },
  });
  return result;
}

describe("scientific presentation boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.demo.mockResolvedValue({
      id: "exact-demo-version",
      publicationId: "demo",
      title: "Synthetic demo",
    });
    state.certifications.mockResolvedValue({ certifications: [] });
    state.passport.mockResolvedValue({
      claimId: "claim-a",
      localClaimId: "local-a",
      versionId: "version-a",
      text: "Assertion A",
      reviewTitle: "Review A",
      reviewSlug: "review-a",
      isExample: true,
      evidence: [],
      alerts: [],
      alsoAssertedIn: [],
      executionPassports: [],
      lineage: [],
      protocolDrift: { snapshots: [] },
    });
  });

  it.each(["completed", "failed", "requested"])(
    "shows %s as a run state, never publication verification",
    async (status) => {
      state.verifications.mockResolvedValue({
        summary: {},
        runs: [
          {
            id: "exact-run",
            status,
            protocol: { seriesKey: "statistics-check", version: "1.0.0" },
            findings:
              status === "completed"
                ? [
                    {
                      id: "pass",
                      findingKey: "reported-mean",
                      findingType: "statistical-value",
                      status: "verified",
                    },
                    {
                      id: "fail",
                      findingKey: "reported-variance",
                      findingType: "statistical-value",
                      status: "discrepancy",
                    },
                  ]
                : [],
          },
        ],
      });
      const html = renderToStaticMarkup(await HomePage());
      expect(html).toContain(`run ${status}`);
      expect(html).toContain("statistics-check · 1.0.0");
      expect(html).toContain('href="/verifications/exact-run"');
      expect(html).toContain("A completed run is not a passed check");
      expect(html).not.toMatch(/verified publication/i);
      if (status === "completed") {
        expect(html).toContain("reported-mean (statistical value): verified");
        expect(html).toContain("reported-variance (statistical value): discrepancy");
      } else {
        expect(html).toContain("No findings recorded for this run");
      }
    },
  );

  it("keeps the publication fallback and does not invent runs when the demo is absent", async () => {
    state.demo.mockResolvedValue(null);
    const html = renderToStaticMarkup(await HomePage());
    expect(html).toContain('href="/publications"');
    expect(html).toContain("No check runs are attached");
    expect(state.verifications).not.toHaveBeenCalled();
  });

  it.each([
    [{ model: "cell culture" }, "Candidate disagreement (no differing declared scope fields)"],
    [{ population: "humans" }, "Scope difference"],
    [undefined, "Candidate disagreement (scope undeclared)"],
  ] as const)(
    "presents raw overlap and unknown scope without inferred independence (%s)",
    async (scope, label) => {
      const result = sharedSourceFixture(scope);
      // Two distinct works share a declared dataset; one work is reused by the opposing claim.
      expect(result.statements[0]!.summary.supportingWorks).toBe(2);
      expect(result.statements[0]!.summary.independentSupportingFamilies).toBe(1);
      const passport = renderToStaticMarkup(
        await ClaimPassportPage({
          params: Promise.resolve({ versionId: "version-a", localClaimId: "local-a" }),
        }),
      );
      expect(passport).toContain("2 (1 source-overlap group)");
      expect(passport).toContain("doi:10.5555/shared-a");
      expect(passport).toContain("Missing overlap metadata does not establish independence");
      expect(passport).toContain("missing fields remain");
      expect(state.passport).toHaveBeenCalledWith("version-a", "local-a");
      const map = renderToStaticMarkup(await SynthesisPage());
      expect(map).toContain(label);
      expect(map).toContain('href="/claims/version-b/local-b"');
      for (const html of [passport, map]) {
        expect(html).not.toMatch(
          /genuine contradiction|independent famil|independent evidence is/i,
        );
      }
    },
  );
});
