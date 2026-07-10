import { describe, expect, it } from "vitest";
import { validateReviewManifest } from "./manifest.js";

const validManifest = {
  schemaVersion: "1.0.0",
  review: {
    title: "Example review",
    abstract: "Example abstract",
    reviewType: "computational-literature-review",
    language: "en",
    keywords: ["example"],
    license: "CC-BY-4.0",
  },
  repository: {
    url: "https://github.com/owner/repository",
    commit: "a".repeat(40),
    releaseTag: "v1.0.0",
  },
  publication: {
    reviewUrl: "https://owner.github.io/repository/",
    versionDoi: "10.5281/zenodo.1234567",
    conceptDoi: "10.5281/zenodo.1234566",
    zenodoRecordId: "1234567",
  },
  contributors: [],
  artifacts: {
    claims: "knowledge/claims.jsonl",
    citations: "knowledge/citations.jsonl",
    relations: "knowledge/claim-evidence-relations.jsonl",
    trustAssessments: "knowledge/trust-assessments.jsonl",
    provenance: "provenance.json",
  },
};

describe("validateReviewManifest", () => {
  it("accepts the reference manifest", () => {
    const result = validateReviewManifest(validManifest);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.manifest?.publication?.versionDoi).toBe("10.5281/zenodo.1234567");
    expect(result.manifest?.publication?.conceptDoi).toBe("10.5281/zenodo.1234566");
  });

  it("keeps version DOI and concept DOI as distinct fields", () => {
    const result = validateReviewManifest(validManifest);
    expect(result.manifest?.publication?.versionDoi).not.toBe(
      result.manifest?.publication?.conceptDoi,
    );
  });

  it("rejects unsafe artifact paths", () => {
    const bad = structuredClone(validManifest);
    bad.artifacts.claims = "../../etc/passwd";
    const result = validateReviewManifest(bad);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toContain("artifacts.claims");
  });

  it("rejects URL-scheme artifact paths", () => {
    const bad = structuredClone(validManifest);
    bad.artifacts.provenance = "https://evil.example/provenance.json";
    expect(validateReviewManifest(bad).ok).toBe(false);
  });

  it("rejects prefixed DOIs (normalization must happen upstream)", () => {
    const bad = structuredClone(validManifest);
    bad.publication.versionDoi = "https://doi.org/10.5281/zenodo.1234567";
    expect(validateReviewManifest(bad).ok).toBe(false);
  });

  it("rejects unknown schema versions and extra properties", () => {
    expect(validateReviewManifest({ ...validManifest, schemaVersion: "2.0.0" }).ok).toBe(false);
    expect(validateReviewManifest({ ...validManifest, extra: true }).ok).toBe(false);
  });

  it("requires only title and repository URL", () => {
    const minimal = {
      schemaVersion: "1.0.0",
      review: { title: "Minimal" },
      repository: { url: "https://github.com/owner/repo" },
    };
    expect(validateReviewManifest(minimal).ok).toBe(true);
  });
});
