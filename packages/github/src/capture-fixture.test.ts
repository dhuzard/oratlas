import { describe, expect, it } from "vitest";
import { canonicalJson, type InspectionReport } from "@oratlas/contracts";
import {
  capturedFixtureFromInspection,
  capturedFixtureOutputFiles,
  createCapturedFixtureTransport,
  verifyCapturedFixture,
} from "./capture-fixture.js";
import { inspectRepository } from "./inspect.js";

const report: InspectionReport = {
  schemaVersion: "1.0.0",
  repo: {
    host: "github.com",
    owner: "lab",
    name: "review",
    canonicalUrl: "https://github.com/lab/review",
  },
  inspectedAt: "2026-01-01T00:00:00.000Z",
  status: "succeeded",
  githubRepositoryId: "123",
  defaultBranch: "main",
  latestCommitSha: "a".repeat(40),
  topics: [],
  tags: [],
  releases: [],
  selectedSource: {
    kind: "default-branch",
    branch: "main",
    commitSha: "a".repeat(40),
    treeSha: "b".repeat(40),
  },
  tree: [
    { path: "review-manifest.json", size: 3 },
    { path: "unfetched.bin", size: 9 },
  ],
  treeTruncated: false,
  files: {
    "review-manifest.json": {
      path: "review-manifest.json",
      size: 3,
      content: "{}\n",
      truncated: false,
    },
  },
  warnings: [],
  limits: {
    maxFileBytes: 10,
    maxTotalBytes: 20,
    maxFileCount: 2,
    totalBytesFetched: 3,
    filesFetched: 1,
  },
};

describe("captured repository fixtures", () => {
  it("is byte-identical across volatile inspection timestamps", () => {
    const first = capturedFixtureFromInspection(report);
    const second = capturedFixtureFromInspection({
      ...report,
      inspectedAt: "2030-01-01T00:00:00.000Z",
    });
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(capturedFixtureOutputFiles(first)).toEqual(capturedFixtureOutputFiles(second));
    expect(() => verifyCapturedFixture(first)).not.toThrow();
  });

  it("hash-binds every fetched byte and rehydrates the inspector transport", async () => {
    const fixture = capturedFixtureFromInspection(report);
    expect(() =>
      verifyCapturedFixture({
        ...fixture,
        files: {
          ...fixture.files,
          "review-manifest.json": {
            ...fixture.files["review-manifest.json"]!,
            content: "tampered",
          },
        },
      }),
    ).toThrow("integrity");
    expect(() =>
      verifyCapturedFixture({
        ...fixture,
        source: { ...fixture.source, treeSha: "c".repeat(40) },
      }),
    ).toThrow("manifest integrity");
    const transport = createCapturedFixtureTransport(fixture);
    expect(
      (await transport.request(`/repos/lab/review/git/commits/${"a".repeat(40)}`)).json,
    ).toMatchObject({ tree: { sha: "b".repeat(40) } });
    const replay = await inspectRepository("https://github.com/lab/review", {
      transport,
      now: () => new Date(0),
    });
    expect(replay.selectedSource).toMatchObject({
      commitSha: "a".repeat(40),
      treeSha: "b".repeat(40),
    });
    expect(replay.files["review-manifest.json"]?.content).toBe("{}\n");
    expect(replay.tree.find((entry) => entry.path === "unfetched.bin")?.size).toBe(9);
  });
});
