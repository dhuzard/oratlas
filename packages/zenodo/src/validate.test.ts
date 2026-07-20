import { describe, expect, it } from "vitest";
import { validateDoi } from "./validate.js";
import { type DoiResolver, type ZenodoRecord } from "./client.js";

function resolverWith(record: ZenodoRecord | null, resolves = true): DoiResolver {
  return {
    async resolveDoi() {
      return {
        resolves,
        status: resolves ? 302 : 404,
        resolvedUrl: "https://zenodo.org/records/9990001",
      };
    },
    async fetchZenodoRecord() {
      return record;
    },
  };
}

const now = () => new Date("2026-07-01T00:00:00Z");

const matchingRecord: ZenodoRecord = {
  recordId: "9990001",
  conceptRecordId: "9990000",
  conceptDoi: "10.5281/zenodo.9990000",
  title: "Hippocampal Replay and Memory Consolidation: A Computational Review",
  creators: ["Rivera, Ada", "Watanabe, Kenji"],
  publicationDate: "2026-06-02",
  relatedUrls: ["https://github.com/example-lab/hippocampal-replay-review/tree/v1.2.0"],
  versionTag: "v1.2.0",
};

describe("validateDoi", () => {
  it("returns example-not-resolvable for reserved example DOIs without any network", async () => {
    let called = false;
    const resolver: DoiResolver = {
      async resolveDoi() {
        called = true;
        return { resolves: true, status: 200 };
      },
      async fetchZenodoRecord() {
        called = true;
        return null;
      },
    };
    const report = await validateDoi(
      { doi: "10.5555/oratlas.example.replay.v1-2-0" },
      { resolver, now },
    );
    expect(report.status).toBe("example-not-resolvable");
    expect(called).toBe(false);
  });

  it("rejects invalid DOI syntax as a hard error", async () => {
    const report = await validateDoi({ doi: "not-a-doi" }, { now });
    expect(report.status).toBe("invalid");
    expect(report.errors.length).toBeGreaterThan(0);
  });

  it("marks a DOI that does not resolve as unresolvable", async () => {
    const report = await validateDoi(
      { doi: "10.5281/zenodo.9990001" },
      { resolver: resolverWith(null, false), now },
    );
    expect(report.status).toBe("unresolvable");
    expect(report.errors.join(" ")).toContain("does not resolve");
  });

  it("does not expose an unsafe resolution URL returned by an injected resolver", async () => {
    const resolver = resolverWith(null, true);
    resolver.resolveDoi = async () => ({
      resolves: true,
      status: 302,
      resolvedUrl: "https://127.0.0.1/internal",
    });

    const report = await validateDoi({ doi: "10.1234/example" }, { resolver, now });

    expect(report.resolvedUrl).toBeUndefined();
    expect(report.checks.find((check) => check.id === "resolution")?.details).toBeUndefined();
  });

  it("validates a matching Zenodo DOI with high confidence", async () => {
    const report = await validateDoi(
      {
        doi: "https://doi.org/10.5281/zenodo.9990001",
        repositoryUrl: "https://github.com/example-lab/hippocampal-replay-review",
        title: "Hippocampal Replay and Memory Consolidation: A Computational Review",
        releaseTag: "v1.2.0",
        expectedKind: "version",
      },
      { resolver: resolverWith(matchingRecord), now },
    );
    expect(report.status).toBe("valid");
    expect(report.confidence).toBe("high");
    expect(report.doiKind).toBe("version");
    expect(report.discoveredConceptDoi).toBe("10.5281/zenodo.9990000");
    expect(report.errors).toEqual([]);
  });

  it("distinguishes a concept DOI from a version DOI", async () => {
    const conceptRecord: ZenodoRecord = {
      ...matchingRecord,
      conceptDoi: "10.5281/zenodo.9990000",
    };
    const report = await validateDoi(
      { doi: "10.5281/zenodo.9990000", expectedKind: "concept" },
      { resolver: resolverWith(conceptRecord), now },
    );
    expect(report.doiKind).toBe("concept");
  });

  it("records mismatches as warnings, not hard errors (does not reject on slight differences)", async () => {
    const report = await validateDoi(
      {
        doi: "10.5281/zenodo.9990001",
        repositoryUrl: "https://github.com/someone-else/unrelated-repo",
        title: "A completely different title about something unrelated",
        releaseTag: "v9.9.9",
        expectedKind: "version",
      },
      { resolver: resolverWith(matchingRecord), now },
    );
    expect(report.status).toBe("valid-with-warnings");
    expect(report.errors).toEqual([]);
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(["low", "medium"]).toContain(report.confidence);
  });

  it("warns but does not fail when Zenodo metadata is unavailable", async () => {
    const report = await validateDoi(
      { doi: "10.5281/zenodo.9990001" },
      { resolver: resolverWith(null, true), now },
    );
    expect(report.status).toBe("valid-with-warnings");
    expect(report.warnings.join(" ")).toContain("Zenodo metadata");
  });
});
