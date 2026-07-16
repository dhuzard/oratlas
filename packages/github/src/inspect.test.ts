import { describe, expect, it } from "vitest";
import { inspectRepository, extractDoisFromText } from "./inspect.js";
import { createFakeTransport } from "./testing.js";
import {
  CLAIM_NODE_JSON,
  NODE_MANIFEST,
  nodePublicationFixture,
  templateCompatibleFixture,
  plainRepoFixture,
} from "./fixtures.js";

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
      source: { kind: "release", tag: "v1.2.0" },
    });
    expect(report.latestCommitSha).toBe("2".repeat(40));
    expect(report.selectedSource).toMatchObject({
      kind: "release",
      releaseTag: "v1.2.0",
      commitSha: releaseCommit,
    });
  });

  it("pins tree traversal to commit.tree and file reads to the selected commit", async () => {
    const requests: string[] = [];
    const fixture = { ...templateCompatibleFixture, requestLog: requests };
    const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
      transport: createFakeTransport(fixture),
      source: { kind: "release", tag: "v1.2.0" },
    });
    expect(report.selectedSource?.treeSha).toBe("f".repeat(40));
    expect(requests).toContain(
      `/repos/${fixture.owner}/${fixture.name}/git/commits/${fixture.commitSha}`,
    );
    expect(requests.some((path) => path.includes(`/git/trees/${"f".repeat(40)}?`))).toBe(true);
    expect(
      requests.some(
        (path) => path.includes("/contents/") && path.endsWith(`ref=${fixture.commitSha}`),
      ),
    ).toBe(true);
  });

  it("uses the exact tag ref target when a stale tag listing disagrees", async () => {
    const currentTarget = "9".repeat(40);
    const fixture = {
      ...plainRepoFixture,
      tags: [{ name: "moving", commitSha: "8".repeat(40), refCommitSha: currentTarget }],
    };
    const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
      transport: createFakeTransport(fixture),
      source: { kind: "tag", tag: "moving" },
    });
    expect(report.selectedSource?.commitSha).toBe(currentTarget);
  });

  it("follows a repository rename while retaining its immutable GitHub id", async () => {
    const requests: string[] = [];
    const fixture = {
      ...plainRepoFixture,
      requestLog: requests,
      repo: {
        ...plainRepoFixture.repo,
        owner: { login: "new-owner" },
        name: "renamed-review",
        html_url: "https://github.com/new-owner/renamed-review",
      },
    };
    const report = await inspectRepository("someone/random-cli-tool", {
      transport: createFakeTransport(fixture),
    });
    expect(report.githubRepositoryId).toBe("999");
    expect(report.repo).toMatchObject({ owner: "new-owner", name: "renamed-review" });
    expect(requests.some((path) => path.startsWith("/repos/new-owner/renamed-review/"))).toBe(true);
  });

  it("refuses to classify a published release as a plain tag", async () => {
    const report = await inspectRepository(
      `${templateCompatibleFixture.owner}/${templateCompatibleFixture.name}`,
      {
        transport: createFakeTransport(templateCompatibleFixture),
        source: { kind: "tag", tag: "v1.2.0" },
      },
    );
    expect(report.status).toBe("failed");
    expect(report.error).toContain("select it as a release");
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
      source: { kind: "release", tag: "v2.0.0" },
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
        source: { kind: "release", tag: "missing" },
      },
    );
    expect(report.status).toBe("failed");
    expect(report.error).toContain("was not found");
    expect(report.selectedSource).toBeUndefined();
  });

  it("fails closed on an annotated-tag cycle within the dereference bound", async () => {
    const outer = "6".repeat(40);
    const inner = "7".repeat(40);
    const fixture = {
      ...plainRepoFixture,
      tags: [{ name: "cycle", commitSha: "8".repeat(40), tagObjectSha: outer }],
      tagObjects: {
        [outer]: { type: "tag" as const, sha: inner },
        [inner]: { type: "tag" as const, sha: outer },
      },
    };
    const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
      transport: createFakeTransport(fixture),
      source: { kind: "tag", tag: "cycle" },
    });
    expect(report.status).toBe("failed");
    expect(report.error).toContain("cycle");
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

  it("fetches manifest-declared node sources at the selected commit without fetching artifacts", async () => {
    const requests: string[] = [];
    const fixture = { ...nodePublicationFixture, requestLog: requests };
    const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
      transport: createFakeTransport(fixture),
    });

    expect(report.status).toBe("succeeded");
    expect(report.files["node-manifest.json"]?.content).toBe(NODE_MANIFEST);
    expect(report.files["nodes/primary-claim.json"]?.content).toBe(CLAIM_NODE_JSON);
    expect(
      requests.some(
        (path) =>
          path.includes("/contents/nodes/primary-claim.json") &&
          path.endsWith(`ref=${nodePublicationFixture.commitSha}`),
      ),
    ).toBe(true);
    for (const artifact of ["figures/main-result.png", "data/observations.csv", "src/analyse.py"]) {
      expect(requests.some((path) => path.includes(`/contents/${artifact}`))).toBe(false);
    }
  });

  it("does not follow paths from a malformed or unsafe node manifest", async () => {
    for (const manifest of [
      "{not-json",
      JSON.stringify({
        schemaVersion: "1.0.0",
        nodes: { format: "json", files: ["../private.json"] },
      }),
    ]) {
      const requests: string[] = [];
      const fixture = {
        ...nodePublicationFixture,
        requestLog: requests,
        files: {
          "node-manifest.json": manifest,
          "nodes/primary-claim.json": CLAIM_NODE_JSON,
        },
      };
      const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
        transport: createFakeTransport(fixture),
      });
      expect(report.status).toBe("partial");
      expect(requests.some((path) => path.includes("private.json"))).toBe(false);
      expect(requests.some((path) => path.includes("nodes/primary-claim.json"))).toBe(false);
    }
  });

  it("uses the manifest cap but applies the normal source-file budget to node records", async () => {
    const report = await inspectRepository(
      `${nodePublicationFixture.owner}/${nodePublicationFixture.name}`,
      {
        transport: createFakeTransport(nodePublicationFixture),
        limits: { maxFileBytes: 100 },
      },
    );
    expect(report.files["node-manifest.json"]?.content).toBeTruthy();
    expect(report.files["nodes/primary-claim.json"]?.truncated).toBe(true);
    expect(report.warnings.join(" ")).toContain("oversized");
  });

  it("marks inspection partial once when the node-source file-count cap is exhausted", async () => {
    const files = ["nodes/a.json", "nodes/b.json", "nodes/c.json"];
    const fixture = {
      ...nodePublicationFixture,
      files: {
        "node-manifest.json": JSON.stringify({
          schemaVersion: "1.0.0",
          nodes: { format: "json", files },
        }),
        ...Object.fromEntries(files.map((path) => [path, CLAIM_NODE_JSON])),
      },
      extraTreePaths: [],
    };
    const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
      transport: createFakeTransport(fixture),
      limits: { maxFileCount: 2 },
    });

    expect(report.status).toBe("partial");
    expect(Object.keys(report.files)).toEqual(["node-manifest.json", "nodes/a.json"]);
    expect(report.warnings.filter((warning) => warning.includes("File fetch cap"))).toEqual([
      "File fetch cap (2) reached; some files not inspected.",
    ]);
  });

  it("never fetches a declared artifact even when its name matches legacy discovery", async () => {
    const requests: string[] = [];
    const figure = JSON.parse(CLAIM_NODE_JSON) as Record<string, unknown>;
    figure.id = "figure:heuristic-overlap";
    figure.kind = "figure";
    figure.title = ""; // Invalid records still must not route artifact fetches.
    figure.provenance = {
      sourcePath: "nodes/figure.json",
      repositoryUrl: "https://github.com/example-lab/node-publications",
      commitSha: nodePublicationFixture.commitSha,
    };
    figure.payload = {
      artifactPath: "artifacts/claims.jsonl",
      caption: "This artifact name overlaps a legacy discovery rule.",
    };
    const fixture = {
      ...nodePublicationFixture,
      requestLog: requests,
      files: {
        "node-manifest.json": JSON.stringify({
          schemaVersion: "1.0.0",
          nodes: { format: "json", files: ["nodes/figure.json"] },
        }),
        "nodes/figure.json": JSON.stringify(figure),
        "artifacts/claims.jsonl": "untrusted artifact bytes",
      },
      extraTreePaths: [],
    };
    const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
      transport: createFakeTransport(fixture),
    });
    expect(report.tree.some((entry) => entry.path === "artifacts/claims.jsonl")).toBe(true);
    expect(report.files["artifacts/claims.jsonl"]).toBeUndefined();
    expect(requests.some((path) => path.includes("/contents/artifacts/claims.jsonl"))).toBe(false);
  });

  it("suppresses ambiguous legacy discovery when a node source is oversized", async () => {
    const requests: string[] = [];
    const artifactPath = "artifacts/claims.jsonl";
    const figure = JSON.parse(CLAIM_NODE_JSON) as Record<string, unknown>;
    figure.id = "figure:oversized-source";
    figure.kind = "figure";
    figure.text = "x".repeat(300);
    figure.provenance = {
      sourcePath: "nodes/oversized-figure.json",
      repositoryUrl: "https://github.com/example-lab/node-publications",
      commitSha: nodePublicationFixture.commitSha,
    };
    figure.payload = {
      artifactPath,
      caption: "Artifact bytes must remain unfetched even when the node source is unavailable.",
    };
    const fixture = {
      ...nodePublicationFixture,
      requestLog: requests,
      files: {
        "node-manifest.json": JSON.stringify({
          schemaVersion: "1.0.0",
          nodes: { format: "json", files: ["nodes/oversized-figure.json"] },
        }),
        "nodes/oversized-figure.json": JSON.stringify(figure),
        [artifactPath]: "untrusted artifact bytes",
      },
      extraTreePaths: [],
    };
    const report = await inspectRepository(`${fixture.owner}/${fixture.name}`, {
      transport: createFakeTransport(fixture),
      limits: { maxFileBytes: 100 },
    });

    expect(report.files["nodes/oversized-figure.json"]?.truncated).toBe(true);
    expect(report.files[artifactPath]).toBeUndefined();
    expect(requests.some((path) => path.includes(`/contents/${artifactPath}`))).toBe(false);
    expect(report.warnings.join(" ")).toContain("artifact-safe explicit fetching");
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
