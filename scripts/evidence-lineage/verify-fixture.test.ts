import { describe, expect, it } from "vitest";
import { verifyFixture } from "./verify-fixture";

describe("evidence-lineage fixture verification (offline)", () => {
  it("passes every fixture check", () => {
    const failing = verifyFixture().filter((check) => check.kind === "fixture" && !check.ok);
    expect(failing).toEqual([]);
  });

  it("reports the pinned extractor baseline as a separate, explicit class of check", () => {
    const baseline = verifyFixture().filter((check) => check.kind === "baseline");
    expect(baseline.map((check) => check.id)).toContain(
      "extractor-baseline:packages/extractor/src/knowledge.ts",
    );
  });
});
