import { describe, expect, it } from "vitest";
import type { KnowledgeIndexData } from "../../packages/knowledge/src/types.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import {
  INDEX_CONTROLS,
  INDEX_PROTOCOL,
  INDEX_READ_TABLES,
  indexCaptureDifferences,
  indexCaptureProblems,
  indexContentProblems,
  indexDigest,
  indexRunnerOutputProblems,
  type IndexCapture,
} from "./index-channel.js";

// Comparator unit inputs are synthetic projections, not claimed database/producer evidence.
const projection = (): KnowledgeIndexData =>
  ({
    reviews: [
      { reviewId: "g1-review-1", status: "published" },
      { reviewId: "g1-review-2", status: "published" },
      { reviewId: INDEX_CONTROLS.withdrawn, status: "withdrawn" },
    ],
    claims: [
      {
        reviewId: "g1-review-1",
        text: "Public claim one",
        relations: [{ citationId: "citation-one" }],
      },
      { reviewId: "g1-review-2", text: "Public claim two", relations: [] },
    ],
    citations: [{ citationId: "citation-one" }],
    identifierConflicts: [],
  }) as unknown as KnowledgeIndexData;
const capture = (): IndexCapture => {
  const index = projection();
  return {
    protocol: INDEX_PROTOCOL,
    label: "baseline",
    roleContract: "public-runtime",
    stateTables: PUBLIC_SELECT_TABLES,
    index,
    indexSha256: indexDigest(index),
    stateBeforeSha256: indexDigest({ rows: 10 }),
    stateAfterSha256: indexDigest({ rows: 10 }),
  };
};

describe("index non-HTTP evidence contract", () => {
  it("rejects credentials and excluded markers in child output without echoing their values", () => {
    expect(indexRunnerOutputProblems("passed", ["secret-value"])).toEqual([]);
    expect(indexRunnerOutputProblems("error secret-value", ["secret-value"])).toEqual([
      "credential in index child output",
    ]);
    expect(indexRunnerOutputProblems("G1_INDEX_EXCLUDED_tombstone", [])).toEqual([
      "excluded marker in index child output",
    ]);
  });
  it("requires populated public reviews, claims and evidence, retaining withdrawn metadata only", () => {
    expect(indexContentProblems(projection())).toEqual([]);
    const empty = { reviews: [], claims: [], citations: [], identifierConflicts: [] };
    expect(indexContentProblems(empty)).toContain("expected two populated public claims");
    const index = projection();
    index.claims[0]!.relations = [];
    expect(indexContentProblems(index)).toContain("missing populated claim/evidence relation");
  });
  it.each([INDEX_CONTROLS.hidden, INDEX_CONTROLS.tombstone, INDEX_CONTROLS.invalidSha])(
    "rejects excluded review %s even when positive data remain",
    (id) => {
      const index = projection();
      index.reviews.push({ ...index.reviews[0]!, reviewId: id });
      expect(indexContentProblems(index)).toContain(`excluded review ${id}`);
    },
  );
  it("rejects withdrawn/hidden content leaking through any projection field", () => {
    const index = projection();
    index.claims[1]!.reviewId = INDEX_CONTROLS.withdrawn;
    expect(indexContentProblems(index)).toContain("withdrawn claim escaped");
    index.citations[0]!.title = "G1_INDEX_EXCLUDED_synthetic";
    expect(indexContentProblems(index)).toContain("excluded marker G1_INDEX_EXCLUDED_");
  });
  it("compares every index byte and database-state digest, ignoring only run labels", () => {
    const first = capture();
    const second = capture();
    second.label = "after";
    expect(indexCaptureDifferences(first, second)).toEqual([]);
    second.index.claims[0]!.text = "Changed actual content";
    second.indexSha256 = indexDigest(second.index);
    expect(indexCaptureDifferences(first, second)).toContain("index bytes differ");
    second.stateAfterSha256 = indexDigest({ rows: 11 });
    expect(indexCaptureProblems(second)).toContain("consumer mutated database");
    second.stateBeforeSha256 = second.stateAfterSha256;
    expect(indexCaptureDifferences(first, second)).toContain("public fixture state differs");
  });
  it("fails stale/tampered digests and declares SELECT-only closure without broad schema grants", () => {
    const value = capture();
    value.indexSha256 = "0".repeat(64);
    expect(indexCaptureProblems(value)).toContain("index digest mismatch");
    expect(INDEX_READ_TABLES).toHaveLength(11);
    expect(new Set(INDEX_READ_TABLES).size).toBe(11);
  });
  it("rejects a same-count row update and comparisons across different runtime authorities", () => {
    const value = capture();
    value.stateBeforeSha256 = indexDigest({ User: [{ id: "synthetic", role: "USER" }] });
    value.stateAfterSha256 = indexDigest({ User: [{ id: "synthetic", role: "ADMIN" }] });
    expect(indexCaptureProblems(value)).toContain("consumer mutated database");
    const other = capture();
    other.roleContract = "read-only-probe";
    other.stateTables = INDEX_READ_TABLES;
    expect(indexCaptureDifferences(capture(), other)).toContain("authority or state scope differs");
  });
  it("rejects unknown authorities/labels and missing, extra or duplicate state scope", () => {
    const value = capture();
    value.roleContract = "unknown" as IndexCapture["roleContract"];
    expect(indexCaptureProblems(value)).toContain("invalid authority or state scope");
    value.roleContract = "public-runtime";
    for (const stateTables of [
      [],
      [...PUBLIC_SELECT_TABLES, "PrivateTable"],
      [...PUBLIC_SELECT_TABLES, PUBLIC_SELECT_TABLES[0]!],
    ]) {
      value.stateTables = stateTables;
      expect(indexCaptureProblems(value)).toContain("invalid authority or state scope");
    }
    value.stateTables = PUBLIC_SELECT_TABLES;
    value.label = "unspecified";
    expect(indexCaptureProblems(value)).toContain("invalid run label");
  });
});
