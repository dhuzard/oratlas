import { describe, expect, it } from "vitest";
import { roCrate } from "./ro-crate.js";
import { type VersionExportInput } from "./types.js";

const version: VersionExportInput = {
  slug: "sample-review",
  versionId: "v-1",
  title: "A Sample Review",
  abstract: "Abstract.",
  contributors: [{ displayName: "Ada Lovelace", familyName: "Lovelace", givenName: "Ada" }],
  keywords: ["methods"],
  domains: [],
  licenseSpdx: "CC-BY-4.0",
  publishedAt: "2026-06-15T00:00:00.000Z",
  versionDoi: "10.5281/zenodo.123456",
  isExample: false,
  repositoryUrl: "https://github.com/example-lab/sample-review",
  commitSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  canonicalUrl: "https://atlas.example.org/reviews/sample-review/versions/v-1",
};

function findEntity(graph: Array<Record<string, unknown>>, id: string) {
  return graph.find((entity) => entity["@id"] === id);
}

describe("roCrate", () => {
  it("describes the dataset, files with checksums, and archival identifiers", () => {
    const crate = roCrate({
      version,
      files: [
        { path: "README.md", size: 120, truncated: false, sha256: "f".repeat(64) },
        { path: "content/review.md", size: 4096, truncated: true },
      ],
      snapshotContentHash: "1".repeat(64),
      capturePayloadHash: "2".repeat(64),
    });
    expect(crate["@context"]).toBe("https://w3id.org/ro/crate/1.1/context");
    const root = findEntity(crate["@graph"], "./")!;
    expect(root.identifier).toEqual([
      version.canonicalUrl,
      "https://doi.org/10.5281/zenodo.123456",
      `swh:1:rev:${"a".repeat(40)}`,
      `swh:1:dir:${"b".repeat(40)}`,
    ]);
    expect(root.hasPart).toEqual([{ "@id": "README.md" }, { "@id": "content/review.md" }]);
    expect(root.license).toEqual({ "@id": "https://spdx.org/licenses/CC-BY-4.0" });
    const readme = findEntity(crate["@graph"], "README.md")!;
    expect(readme.sha256).toBe("f".repeat(64));
    const truncated = findEntity(crate["@graph"], "content/review.md")!;
    expect(truncated.disambiguatingDescription).toContain("truncated");
    expect(String(root.disambiguatingDescription)).toContain("1".repeat(64));
    expect(String(root.disambiguatingDescription)).toContain("2".repeat(64));
  });

  it("never emits example DOIs or ORCIDs as identifiers", () => {
    const crate = roCrate({
      version: {
        ...version,
        isExample: true,
        versionDoi: "10.5555/zenodo.1",
        contributors: [{ displayName: "Demo", orcid: "0000-0000-0000-0001" }],
      },
      files: [],
    });
    const serialized = JSON.stringify(crate);
    expect(serialized).not.toContain("doi.org");
    expect(serialized).not.toContain("orcid.org");
    const root = findEntity(crate["@graph"], "./")!;
    expect(String(root.disambiguatingDescription)).toContain("synthetic examples");
  });
});
