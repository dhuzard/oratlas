import { describe, expect, it } from "vitest";
import { provJsonLd } from "./prov.js";

const base = {
  platformVersion: "0.1.0",
  canonicalUrl: "https://atlas.example.org/reviews/sample-review/versions/v-1",
  versionId: "v-1",
  title: "A Sample Review",
  repositoryUrl: "https://github.com/example-lab/sample-review",
  commitSha: "a".repeat(40),
  treeSha: "b".repeat(40),
  capture: { payloadHash: "3".repeat(64), capturedAt: "2026-06-14T10:00:00.000Z" },
  submission: {
    id: "sub-1",
    submittedAt: "2026-06-14T11:00:00.000Z",
    submitterLogin: "atlas-submitter",
  },
  acceptance: { publishedAt: "2026-06-15T00:00:00.000Z", editorLogin: "atlas-editor" },
};

function byId(graph: Array<Record<string, unknown>>, id: string) {
  return graph.find((entity) => entity["@id"] === id);
}

describe("provJsonLd", () => {
  it("chains repository state → capture → submission → version", () => {
    const doc = provJsonLd(base);
    const graph = doc["@graph"];
    const capture = byId(graph, `${base.canonicalUrl}#capture`)!;
    expect(capture["prov:wasDerivedFrom"]).toEqual({
      "@id": `${base.repositoryUrl}/commit/${base.commitSha}`,
    });
    const submission = byId(graph, `${base.canonicalUrl}#submission`)!;
    expect(submission["prov:wasDerivedFrom"]).toEqual({ "@id": `${base.canonicalUrl}#capture` });
    const version = byId(graph, `${base.canonicalUrl}#version`)!;
    expect(version["prov:wasDerivedFrom"]).toEqual({ "@id": `${base.canonicalUrl}#submission` });
    expect(version["prov:wasGeneratedBy"]).toEqual({ "@id": `${base.canonicalUrl}#acceptance` });
    expect(version["oratlas:exportedByPlatformVersion"]).toBe("0.1.0");
    const acceptance = byId(graph, `${base.canonicalUrl}#acceptance`)!;
    expect(acceptance["prov:wasAssociatedWith"]).toEqual({ "@id": `${base.canonicalUrl}#editor` });
  });

  it("derives the version directly from the repository state when no capture exists", () => {
    const doc = provJsonLd({ ...base, capture: undefined, submission: undefined });
    const version = byId(doc["@graph"], `${base.canonicalUrl}#version`)!;
    expect(version["prov:wasDerivedFrom"]).toEqual({
      "@id": `${base.repositoryUrl}/commit/${base.commitSha}`,
    });
    expect(byId(doc["@graph"], `${base.canonicalUrl}#capture`)).toBeUndefined();
  });

  it("scopes the oratlas context to the archive origin", () => {
    const doc = provJsonLd(base);
    expect(doc["@context"].oratlas).toBe("https://atlas.example.org/ns#");
  });
});
