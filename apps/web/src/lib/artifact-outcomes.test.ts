import { describe, expect, it } from "vitest";
import { ARTIFACT_KINDS, presentArtifactOutcomes } from "./artifact-outcomes";

const source = (
  status: "loaded" | "invalid" | "skipped",
  overrides: Record<string, unknown> = {},
) => ({
  path: "data/artifact.json",
  discovery: "declared",
  status,
  loadedCount: status === "loaded" ? 1 : 0,
  skippedCount: status === "skipped" ? null : status === "invalid" ? 1 : 0,
  issues: status === "loaded" ? [] : [{ code: "invalid-json", message: "Invalid JSON." }],
  ...overrides,
});

function report(): Record<string, unknown> {
  return {
    schemaVersion: "1.1.0",
    artifactOutcomes: {
      claims: { status: "not-declared", loadedCount: 0, skippedCount: 0, sources: [] },
      citations: {
        status: "invalid",
        loadedCount: 0,
        skippedCount: 1,
        sources: [source("invalid")],
      },
      relations: {
        status: "loaded",
        loadedCount: 0,
        skippedCount: 0,
        sources: [source("loaded", { loadedCount: 0 })],
      },
      trust: {
        status: "loaded",
        loadedCount: 2,
        skippedCount: 1,
        sources: [source("loaded", { loadedCount: 2, skippedCount: 1 })],
      },
      nodes: {
        status: "skipped",
        loadedCount: 0,
        skippedCount: null,
        sources: [source("skipped")],
      },
      edges: {
        status: "loaded",
        loadedCount: 0,
        skippedCount: 0,
        sources: [source("loaded", { loadedCount: 0, discovery: "discovered" })],
      },
    },
  };
}

describe("artifact outcome presentation", () => {
  it("keeps every canonical artifact outcome distinct", () => {
    const rows = presentArtifactOutcomes(report());
    expect(
      rows.map(({ artifact, state, label, detail }) => ({ artifact, state, label, detail })),
    ).toEqual([
      { artifact: "claims", state: "not-declared", label: "Not declared", detail: undefined },
      {
        artifact: "citations",
        state: "invalid",
        label: "Declared but invalid",
        detail: "0 records loaded; 1 record skipped",
      },
      {
        artifact: "relations",
        state: "loaded-empty",
        label: "Declared and loaded — empty",
        detail: "0 records loaded",
      },
      {
        artifact: "trust",
        state: "loaded",
        label: "Loaded",
        detail: "2 records loaded; 1 record skipped",
      },
      {
        artifact: "nodes",
        state: "skipped",
        label: "Skipped / unavailable",
        detail: "0 records loaded; skipped count unavailable",
      },
      {
        artifact: "edges",
        state: "loaded-empty",
        label: "Discovered and loaded — empty",
        detail: "0 records loaded",
      },
    ]);
    expect(rows[1]?.reasons).toEqual(["data/artifact.json: Invalid JSON."]);
    expect(rows[4]?.reasons).toEqual(["data/artifact.json: Invalid JSON."]);
  });

  it.each([undefined, { schemaVersion: "1.0.0" }])(
    "labels absent and legacy reports as predating artifact outcomes",
    (legacy) => {
      const rows = presentArtifactOutcomes(legacy, ["claims"]);
      expect(rows).toEqual([
        {
          artifact: "claims",
          state: "legacy",
          label: "Unknown — report predates per-artifact outcomes",
          reasons: [],
        },
      ]);
    },
  );

  it("defines the six contract artifact keys once", () => {
    expect(ARTIFACT_KINDS).toEqual(["claims", "citations", "relations", "trust", "nodes", "edges"]);
  });
});
