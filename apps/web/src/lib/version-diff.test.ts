import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalEvidenceEdges, diffCanonicalRecords } from "./version-diff";

describe("canonical version diff", () => {
  it("is deterministic regardless of insertion order", () => {
    const first = diffCanonicalRecords(
      { b: { value: 2 }, a: { value: 1 } },
      { c: { value: 3 }, b: { value: 4 } },
    );
    const second = diffCanonicalRecords(
      { a: { value: 1 }, b: { value: 2 } },
      { b: { value: 4 }, c: { value: 3 } },
    );
    expect(first).toEqual(second);
    expect(first.added).toEqual(["c"]);
    expect(first.removed).toEqual(["a"]);
    expect(first.changed.map((change) => change.key)).toEqual(["b"]);
  });

  it("orders evidence by logical tuples rather than insertion or database ids", () => {
    const edges = [
      {
        citationLocalId: "ref-b",
        relationType: "supports",
        supportDirection: null,
        sourceLocation: "relations.jsonl:2",
      },
      {
        citationLocalId: "ref-a",
        relationType: "contradicts",
        supportDirection: "negative",
        sourceLocation: "relations.jsonl:9",
      },
      {
        citationLocalId: "ref-a",
        relationType: "supports",
        supportDirection: "positive",
        sourceLocation: "relations.jsonl:1",
      },
    ];
    const forward = canonicalEvidenceEdges(edges);
    const reverse = canonicalEvidenceEdges([...edges].reverse());
    expect(forward).toEqual(reverse);
    expect(forward.map((edge) => `${edge.citationLocalId}:${edge.relationType}`)).toEqual([
      "ref-a:contradicts",
      "ref-a:supports",
      "ref-b:supports",
    ]);
  });
});
