import { describe, expect, it } from "vitest";
import { inspectRepository, extractDoisFromText } from "./inspect.js";
import { createFakeTransport } from "./testing.js";
import { templateCompatibleFixture, plainRepoFixture } from "./fixtures.js";

describe("inspectRepository", () => {
  it("inspects a template-compatible repository and fetches well-known files", async () => {
    const report = await inspectRepository("example-lab/hippocampal-replay-review", {
      transport: createFakeTransport(templateCompatibleFixture),
      now: () => new Date("2026-07-01T00:00:00Z"),
    });

    expect(report.status).not.toBe("failed");
    expect(report.repo.canonicalUrl).toBe("https://github.com/example-lab/hippocampal-replay-review");
    expect(report.latestCommitSha).toBe("b".repeat(40));
    expect(report.licenseSpdx).toBe("CC-BY-4.0");
    expect(report.releases[0]?.tagName).toBe("v1.2.0");
    expect(report.releases[0]?.bodyDois).toContain("10.5555/oratlas.example.replay.v1-2-0");
    expect(report.pagesUrl).toBe("https://example-lab.github.io/hippocampal-replay-review/");
    expect(Object.keys(report.files)).toContain("review-manifest.json");
    expect(Object.keys(report.files)).toContain("knowledge/claims.jsonl");
    expect(report.files["review-manifest.json"]?.content).toContain("schemaVersion");
  });

  it("rejects unsafe URLs before any network call", async () => {
    const report = await inspectRepository("https://api.github.com/repos/a/b");
    expect(report.status).toBe("failed");
    expect(report.error).toBeTruthy();
  });

  it("reports a not-found repository as failed", async () => {
    const transport = createFakeTransport({ ...plainRepoFixture, owner: "someone", name: "random-cli-tool" });
    const report = await inspectRepository("someone/does-not-exist", { transport });
    expect(report.status).toBe("failed");
  });

  it("enforces the per-file size limit", async () => {
    const big = "x".repeat(2000);
    const transport = createFakeTransport({
      ...plainRepoFixture,
      files: { "README.md": big, "package.json": "{}" },
    });
    const report = await inspectRepository("someone/random-cli-tool", {
      transport,
      limits: { maxFileBytes: 100 },
    });
    expect(report.files["README.md"]?.truncated).toBe(true);
    expect(report.warnings.join(" ")).toContain("oversized");
  });
});

describe("extractDoisFromText", () => {
  it("extracts DOIs and trims trailing punctuation", () => {
    expect(extractDoisFromText("See https://doi.org/10.5281/zenodo.123456.")).toEqual([
      "10.5281/zenodo.123456",
    ]);
    expect(extractDoisFromText("no doi here")).toEqual([]);
  });
});
