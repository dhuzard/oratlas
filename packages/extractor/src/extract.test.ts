import { describe, expect, it } from "vitest";
import { inspectRepository, createFakeTransport } from "@oratlas/github";
import {
  templateCompatibleFixture,
  partiallyCompatibleFixture,
  plainRepoFixture,
  CITATION_CFF,
  ZENODO_JSON,
} from "@oratlas/github/fixtures";
import { runExtraction } from "./index.js";
import { parseCitationCff, parseZenodoJson } from "./sources.js";

const now = () => new Date("2026-07-01T00:00:00Z");

async function inspect(fixture: Parameters<typeof createFakeTransport>[0]) {
  return inspectRepository(`${fixture.owner}/${fixture.name}`, {
    transport: createFakeTransport(fixture),
    now,
  });
}

describe("runExtraction — template-compatible repository", () => {
  it("extracts manifest-sourced metadata with provenance and priority", async () => {
    const report = await inspect(templateCompatibleFixture);
    const result = runExtraction(report, now);

    expect(result.manifestPresent).toBe(true);
    const title = result.metadata.fields.title;
    expect(title?.value).toContain("Hippocampal Replay");
    // Manifest is the highest-priority source.
    expect(title?.provenance.source).toBe("review-manifest");
    expect(title?.provenance.file).toBe("review-manifest.json");
    expect(title?.provenance.confidence).toBe(1);

    // Version DOI and concept DOI are separate fields.
    expect(result.metadata.fields.versionDoi?.value).toBe(
      "10.5555/oratlas.example.replay.v1-2-0",
    );
    expect(result.metadata.fields.conceptDoi?.value).toBe(
      "10.5555/oratlas.example.replay.concept",
    );
    expect(result.metadata.fields.versionDoi?.value).not.toBe(
      result.metadata.fields.conceptDoi?.value,
    );
  });

  it("ingests knowledge artifacts with referential integrity", async () => {
    const report = await inspect(templateCompatibleFixture);
    const result = runExtraction(report, now);
    expect(result.knowledge.claims.map((c) => c.id)).toEqual(["claim-001", "claim-002"]);
    expect(result.knowledge.citations).toHaveLength(2);
    expect(result.knowledge.relations).toHaveLength(2);
    expect(result.knowledge.trust).toHaveLength(1);
  });

  it("classifies as compatible or verified-template with explained signals", async () => {
    const report = await inspect(templateCompatibleFixture);
    const result = runExtraction(report, now);
    expect(["compatible", "verified-template"]).toContain(
      result.compatibility.overallCompatibility,
    );
    expect(result.compatibility.mystProjectDetected.detected).toBe(true);
    expect(result.compatibility.bibliographyDetected.detected).toBe(true);
    expect(result.compatibility.releaseDetected.detected).toBe(true);
    expect(result.compatibility.doiDetected.detected).toBe(true);
    expect(result.compatibility.levelRationale.length).toBeGreaterThan(0);
  });
});

describe("runExtraction — partially compatible repository", () => {
  it("has no manifest and is classified partially-compatible", async () => {
    const report = await inspect(partiallyCompatibleFixture);
    const result = runExtraction(report, now);
    expect(result.manifestPresent).toBe(false);
    // Title falls back to CITATION.cff.
    expect(result.metadata.fields.title?.provenance.source).toBe("citation-cff");
    expect(
      ["partially-compatible", "compatible"].includes(
        result.compatibility.overallCompatibility,
      ),
    ).toBe(true);
    expect(result.compatibility.recommendations.join(" ")).toContain("Zenodo");
  });
});

describe("runExtraction — non-review repository", () => {
  it("is classified unsupported with a blocking error", async () => {
    const report = await inspect(plainRepoFixture);
    const result = runExtraction(report, now);
    expect(result.compatibility.overallCompatibility).toBe("unsupported");
    expect(result.compatibility.blockingErrors.length).toBeGreaterThan(0);
  });
});

describe("source parsers", () => {
  it("parses CITATION.cff authors and ORCIDs", () => {
    const parsed = parseCitationCff(CITATION_CFF);
    expect(parsed.authors?.[0]?.displayName).toBe("Ada Rivera");
    expect(parsed.authors?.[0]?.orcid).toBe("0000-0002-1825-0097");
    expect(parsed.license).toBe("CC-BY-4.0");
  });

  it("parses .zenodo.json creators", () => {
    const parsed = parseZenodoJson(ZENODO_JSON);
    expect(parsed.authors?.map((a) => a.displayName)).toContain("Rivera, Ada");
    expect(parsed.title).toContain("Hippocampal Replay");
  });
});
