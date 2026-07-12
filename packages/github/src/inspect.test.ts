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
    expect(report.repo.canonicalUrl).toBe(
      "https://github.com/example-lab/hippocampal-replay-review",
    );
    expect(report.latestCommitSha).toBe("b".repeat(40));
    expect(report.githubRepositoryId).toBe("424242");
    expect(report.selectedSource).toMatchObject({
      kind: "default-branch",
      commitSha: templateCompatibleFixture.commitSha,
      branch: "main",
    });
    expect(report.licenseSpdx).toBe("CC-BY-4.0");
    expect(report.releases[0]?.tagName).toBe("v1.2.0");
    expect(report.releases[0]?.bodyDois).toContain("10.5555/oratlas.example.replay.v1-2-0");
    expect(report.pagesUrl).toBe("https://example-lab.github.io/hippocampal-replay-review/");
    expect(Object.keys(report.files)).toContain("review-manifest.json");
    expect(Object.keys(report.files)).toContain("knowledge/claims.jsonl");
    expect(report.files["review-manifest.json"]?.content).toContain("schemaVersion");
  });

  it("selects a release commit even when the default branch has moved", async () => {
    const releaseCommit = "1".repeat(40);
    const fixture = {
      ...templateCompatibleFixture,
      commitSha: "2".repeat(40),
      tags: [{ name: "v1.2.0", commitSha: releaseCommit }],
    };
    const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
      transport: createFakeTransport(fixture),
      releaseTag: "v1.2.0",
    });
    expect(report.latestCommitSha).toBe("2".repeat(40));
    expect(report.selectedSource).toMatchObject({
      kind: "release",
      releaseTag: "v1.2.0",
      commitSha: releaseCommit,
    });
  });

  it("dereferences nested annotated tags to their commit", async () => {
    const commitSha = "3".repeat(40);
    const outerTag = "4".repeat(40);
    const innerTag = "5".repeat(40);
    const fixture = {
      ...templateCompatibleFixture,
      tags: [{ name: "v2.0.0", commitSha, tagObjectSha: outerTag }],
      tagObjects: {
        [outerTag]: { type: "tag" as const, sha: innerTag },
        [innerTag]: { type: "commit" as const, sha: commitSha },
      },
      releases: [
        {
          tag_name: "v2.0.0",
          name: "v2.0.0",
          html_url: "https://github.com/example-lab/hippocampal-replay-review/releases/tag/v2.0.0",
          published_at: "2026-06-02T00:00:00Z",
          draft: false,
          prerelease: false,
          body: "",
        },
      ],
    };
    const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
      transport: createFakeTransport(fixture),
      releaseTag: "v2.0.0",
    });
    expect(report.selectedSource).toMatchObject({
      kind: "release",
      commitSha,
      tagObjectSha: outerTag,
    });
  });

  it("fails closed when an explicitly selected tag cannot be resolved", async () => {
    const report = await inspectRepository(
      `${templateCompatibleFixture.owner}/${templateCompatibleFixture.name}`,
      {
        transport: createFakeTransport(templateCompatibleFixture),
        releaseTag: "missing",
      },
    );
    expect(report.status).toBe("failed");
    expect(report.error).toContain("was not found");
    expect(report.selectedSource).toBeUndefined();
  });

  it("rejects unsafe URLs before any network call", async () => {
    const report = await inspectRepository("https://api.github.com/repos/a/b");
    expect(report.status).toBe("failed");
    expect(report.error).toBeTruthy();
  });

  it("reports a not-found repository as failed", async () => {
    const transport = createFakeTransport({
      ...plainRepoFixture,
      owner: "someone",
      name: "random-cli-tool",
    });
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
