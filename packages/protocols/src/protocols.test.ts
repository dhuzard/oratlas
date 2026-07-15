import { describe, expect, it } from "vitest";
import {
  adaptClinicalTrialsGovStudy,
  adaptOsfRegistration,
  compareProtocolToReview,
  ProtocolRegistryClient,
  protocolSnapshotInputSchema,
  type ProtocolTransport,
} from "./index.js";

const capture = {
  sourceUrl: "https://clinicaltrials.gov/study/NCT01234567",
  sourceVersion: 'W/"study-2026-07-14"',
  fetchedAt: "2026-07-15T08:00:00.000Z",
};

describe("protocol registry adapters", () => {
  it("normalizes ClinicalTrials.gov v2 eligibility, outcomes, and design provenance", () => {
    const protocol = adaptClinicalTrialsGovStudy(
      {
        protocolSection: {
          identificationModule: { nctId: "NCT01234567", briefTitle: "Dense probe trial" },
          statusModule: {
            studyFirstPostDateStruct: { date: "2025-01-01" },
            lastUpdatePostDateStruct: { date: "2026-07-14" },
          },
          eligibilityModule: {
            sex: "ALL",
            minimumAge: "18 Years",
            maximumAge: "70 Years",
            healthyVolunteers: false,
            eligibilityCriteria:
              "Inclusion Criteria:\nAdults with dense probes\n\nExclusion Criteria:\nPrior implant infection",
          },
          outcomesModule: {
            primaryOutcomes: [
              { measure: "Sorting accuracy", timeFrame: "12 months", description: "F1 score" },
            ],
          },
          designModule: {
            studyType: "INTERVENTIONAL",
            phases: ["NA"],
            designInfo: { allocation: "RANDOMIZED", maskingInfo: { masking: "DOUBLE" } },
          },
        },
      },
      capture,
    );
    expect(protocol.source).toMatchObject({
      registry: "clinicaltrials-gov",
      sourceId: "NCT01234567",
      sourceVersion: capture.sourceVersion,
    });
    expect(protocol.fields.population.map((row) => row.value)).toContain(
      "Adults with dense probes",
    );
    expect(protocol.fields.exclusions[0]?.value).toBe("Prior implant infection");
    expect(protocol.fields.outcomes[0]?.sourcePointer).toContain("primaryOutcomes/0");
    expect(protocol.unclassified.some((row) => row.value.includes("RANDOMIZED"))).toBe(true);
    expect(protocol.unclassified.find((row) => row.value.includes("DOUBLE"))?.sourcePointer).toBe(
      "/protocolSection/designModule/designInfo/maskingInfo/masking",
    );
    expect(protocol.fields["analysis-plan"]).toEqual([]);
  });

  it("requires OSF schema labels and preserves unclassified answers without guessing", () => {
    const raw = {
      data: {
        id: "abc12",
        attributes: {
          title: "Registered review",
          date_registered: "2026-01-01T00:00:00.000Z",
          date_modified: "2026-01-02T00:00:00.000Z",
          registered_meta: {
            q_population: { value: "Adults with chronic implants" },
            opaque: { value: "This must not be guessed" },
          },
        },
      },
    };
    const protocol = adaptOsfRegistration(
      raw,
      [
        {
          id: "q_population",
          label: "Describe the target population",
          category: "population",
        },
        { id: "opaque", label: "Repository license", category: "unclassified" },
      ],
      { ...capture, sourceUrl: "https://osf.io/abc12/", sourceVersion: "2026-01-02T00:00:00Z" },
    );
    expect(protocol.fields.population).toHaveLength(1);
    expect(protocol.unclassified[0]?.value).toContain("must not be guessed");
    expect(() =>
      adaptOsfRegistration(
        raw,
        [{ id: "q_population", label: "Target population", category: "population" }],
        {
          ...capture,
          sourceUrl: "https://osf.io/abc12/",
        },
      ),
    ).toThrow(/missing/i);
    expect(() => adaptOsfRegistration({ data: {} }, [], capture)).toThrow();
  });

  it("keeps network behind an injected transport", async () => {
    const calls: string[] = [];
    const transport: ProtocolTransport = {
      async getJson(url) {
        calls.push(url);
        return {
          body: { fixture: true },
          fetchedAt: capture.fetchedAt,
          sourceVersion: "fixture-v1",
        };
      },
    };
    const client = new ProtocolRegistryClient(transport);
    await client.fetchOsfRegistration("abc/12");
    await client.fetchClinicalTrial("NCT01234567");
    expect(calls).toEqual([
      "https://api.osf.io/v2/registrations/abc%2F12/",
      "https://clinicaltrials.gov/api/v2/studies/NCT01234567",
    ]);
  });

  it("fails closed when provenance URLs do not match the selected registry", () => {
    const parsed = protocolSnapshotInputSchema.safeParse({
      reviewVersionId: "version-1",
      registry: "clinicaltrials-gov",
      sourceUrl: "https://example.org/study/NCT01234567",
      sourceVersion: "v1",
      fetchedAt: capture.fetchedAt,
      payload: {},
    });
    expect(parsed.success).toBe(false);
    expect(
      protocolSnapshotInputSchema.safeParse({
        reviewVersionId: "version-1",
        registry: "clinicaltrials-gov",
        sourceUrl: "https://user:secret@clinicaltrials.gov/study/NCT01234567?token=secret",
        sourceVersion: "v1",
        fetchedAt: capture.fetchedAt,
        payload: {},
      }).success,
    ).toBe(false);
    expect(
      protocolSnapshotInputSchema.safeParse({
        reviewVersionId: "version-1",
        registry: "clinicaltrials-gov",
        sourceUrl: "https://clinicaltrials.gov/study/NCT01234567",
        sourceVersion: "v1",
        fetchedAt: capture.fetchedAt,
        payload: {},
        osfQuestions: [{ id: "q1", label: "Population", category: "population" }],
      }).success,
    ).toBe(false);
    expect(
      protocolSnapshotInputSchema.safeParse({
        reviewVersionId: "version-1",
        registry: "osf",
        sourceUrl: "https://osf.io/abc12/",
        sourceVersion: "v1",
        fetchedAt: capture.fetchedAt,
        payload: {},
        osfQuestions: [
          { id: "q1", label: "Population", category: "population" },
          { id: "q1", label: "Outcome", category: "outcomes" },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("protocol drift comparison", () => {
  it("is deterministic, idempotent, and labels differences as neutral proposals", () => {
    const protocol = adaptClinicalTrialsGovStudy(
      {
        protocolSection: {
          identificationModule: { nctId: "NCT01234567", briefTitle: "Dense probe trial" },
          eligibilityModule: { eligibilityCriteria: "Adults with dense probes" },
          outcomesModule: { primaryOutcomes: [{ measure: "Sorting accuracy" }] },
          designModule: { designInfo: { allocation: "RANDOMIZED" } },
        },
      },
      capture,
    );
    const observed = {
      reviewVersionId: "version-1",
      targetKey: "review-version:version-1",
      fields: {
        population: [
          { value: "Adults with dense probes", sourcePointer: "claim:claim-1/scope/population" },
        ],
        outcomes: [{ value: "Spike yield", sourcePointer: "claim:claim-1/scope/outcome" }],
        exclusions: [],
        "analysis-plan": [],
      },
    };
    const first = compareProtocolToReview(protocol, observed);
    const second = compareProtocolToReview(protocol, observed);
    expect(second).toEqual(first);
    expect(first.map((row) => row.category)).toEqual(["outcomes"]);
    expect(first.every((row) => row.rationale.startsWith("Human review requested:"))).toBe(true);
    expect(JSON.stringify(first).toLowerCase()).not.toMatch(/misconduct|violation|fraud/);

    const recaptured = adaptClinicalTrialsGovStudy(
      {
        protocolSection: {
          identificationModule: { nctId: "NCT01234567", briefTitle: "Dense probe trial" },
          eligibilityModule: { eligibilityCriteria: "Adults with dense probes" },
          outcomesModule: { primaryOutcomes: [{ measure: "Sorting accuracy" }] },
          designModule: { designInfo: { allocation: "RANDOMIZED" } },
        },
      },
      {
        ...capture,
        sourceUrl: "https://www.clinicaltrials.gov/study/NCT01234567",
        fetchedAt: "2026-07-16T08:00:00.000Z",
      },
    );
    expect(compareProtocolToReview(recaptured, observed).map((row) => row.id)).toEqual(
      first.map((row) => row.id),
    );
  });

  it("fails closed on malformed normalized inputs", () => {
    expect(() => compareProtocolToReview({} as never, {} as never)).toThrow();
    expect(() =>
      adaptClinicalTrialsGovStudy(
        {
          protocolSection: {
            identificationModule: { nctId: "NCT1", briefTitle: "Malformed identifier" },
          },
        },
        capture,
      ),
    ).toThrow();
  });

  it("uses explicit OSF categories and does not let unclassified answers hide drift", () => {
    const protocol = adaptOsfRegistration(
      {
        data: {
          id: "abc12",
          attributes: {
            title: "Ambiguity-safe registration",
            registered_meta: {
              q_blinding: { value: "Yes" },
              q_license: { value: "CC0" },
            },
          },
        },
      },
      [
        {
          id: "q_blinding",
          label: "Were outcome assessors blinded?",
          category: "unclassified",
        },
        { id: "q_license", label: "Repository license", category: "unclassified" },
      ],
      { ...capture, sourceUrl: "https://osf.io/abc12/" },
    );
    expect(protocol.fields.outcomes).toEqual([]);
    const proposals = compareProtocolToReview(protocol, {
      reviewVersionId: "version-1",
      targetKey: "review-version:version-1",
      fields: {
        population: [{ value: "Adults", sourcePointer: "claim:claim-1/scope/population" }],
        outcomes: [],
        exclusions: [],
        "analysis-plan": [],
      },
    });
    expect(proposals.map((row) => [row.category, row.kind])).toEqual([
      ["population", "not-registered"],
    ]);
  });
});
