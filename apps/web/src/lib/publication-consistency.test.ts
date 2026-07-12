import { describe, expect, it } from "vitest";
import {
  type DoiValidationReport,
  type EffectiveMetadata,
  type InspectionReport,
} from "@oratlas/contracts";
import { buildPublicationConsistency } from "./publication-consistency";

const commit = "a".repeat(40);
const tree = "b".repeat(40);

function report(kind: "default-branch" | "tag" | "release" = "release"): InspectionReport {
  const releaseTag = kind === "default-branch" ? undefined : "v1.2.0";
  return {
    schemaVersion: "1.0.0",
    repo: {
      host: "github.com",
      owner: "lab",
      name: "review",
      canonicalUrl: "https://github.com/lab/review",
    },
    inspectedAt: "2026-07-12T00:00:00.000Z",
    status: "succeeded",
    githubRepositoryId: "42",
    topics: [],
    tags: releaseTag ? [{ name: releaseTag, commitSha: commit }] : [],
    releases:
      kind === "release"
        ? [
            {
              tagName: "v1.2.0",
              name: "v1.2.0",
              htmlUrl: "https://github.com/lab/review/releases/tag/v1.2.0",
              publishedAt: "2026-07-01T00:00:00Z",
              isDraft: false,
              isPrerelease: false,
              bodyDois: ["10.5281/zenodo.10"],
            },
          ]
        : [],
    selectedSource: {
      kind,
      commitSha: commit,
      treeSha: tree,
      ...(kind === "default-branch" ? { branch: "main" } : { releaseTag }),
    },
    tree: [],
    treeTruncated: false,
    files: {},
    warnings: [],
    limits: {
      maxFileBytes: 1,
      maxTotalBytes: 1,
      maxFileCount: 1,
      totalBytesFetched: 0,
      filesFetched: 0,
    },
  };
}

function doi(overrides: Partial<DoiValidationReport> = {}): DoiValidationReport {
  return {
    schemaVersion: "1.0.0",
    input: "10.5281/zenodo.10",
    normalizedDoi: "10.5281/zenodo.10",
    status: "valid",
    isZenodo: true,
    doiKind: "version",
    zenodoRecordId: "10",
    recordCreators: [],
    recordRepositoryUrls: [`https://github.com/lab/review/commit/${commit}`],
    recordVersionTag: "1.2.0",
    checks: [],
    errors: [],
    warnings: [],
    confidence: "high",
    validatedAt: "2026-07-12T00:00:00.000Z",
    ...overrides,
  };
}

const releasedMetadata: EffectiveMetadata = {
  title: "Review",
  authors: [],
  keywords: [],
  domains: [],
  commitSha: commit,
  releaseTag: "v1.2.0",
  versionDoi: "10.5281/zenodo.10",
  zenodoRecordId: "10",
};

describe("buildPublicationConsistency", () => {
  it("passes a release, deposit, tag and commit that all agree", () => {
    const result = buildPublicationConsistency(report(), releasedMetadata, { versionDoi: doi() });
    expect(result.status).toBe("pass");
    expect(result.requiresEditorOverride).toBe(false);
    expect(result.overridableCheckIds).toEqual([]);
  });

  it("keeps a deliberate repository-only capture valid", () => {
    const result = buildPublicationConsistency(
      report("default-branch"),
      { title: "Review", authors: [], keywords: [], domains: [], commitSha: commit },
      undefined,
    );
    expect(result.status).toBe("not-applicable");
    expect(result.requiresEditorOverride).toBe(false);
  });

  it("fails each divergent tag, deposit record and commit as a scoped check", () => {
    const result = buildPublicationConsistency(
      report(),
      { ...releasedMetadata, releaseTag: "v9", zenodoRecordId: "99" },
      {
        versionDoi: doi({
          recordVersionTag: "v8",
          zenodoRecordId: "10",
          recordRepositoryUrls: [`https://github.com/lab/review/commit/${"c".repeat(40)}`],
        }),
      },
    );
    expect(result.status).toBe("fail");
    expect(result.overridableCheckIds).toEqual(
      expect.arrayContaining([
        "source-release-tag",
        "deposit-release-tag",
        "deposit-record-id",
        "deposit-commit",
      ]),
    );
  });

  it("fails when metadata claims another commit", () => {
    const result = buildPublicationConsistency(
      report("tag"),
      {
        ...releasedMetadata,
        versionDoi: undefined,
        zenodoRecordId: undefined,
        commitSha: "d".repeat(40),
      },
      undefined,
    );
    expect(result.overridableCheckIds).toContain("metadata-commit");
  });

  it("requires explicit release selection when a version DOI is supplied", () => {
    const result = buildPublicationConsistency(report("default-branch"), releasedMetadata, {
      versionDoi: doi(),
    });
    expect(result.overridableCheckIds).toEqual(
      expect.arrayContaining(["source-release-tag", "version-doi-source"]),
    );
  });

  it("fails unresolved/example DOI statuses and wrong DOI roles independently", () => {
    const result = buildPublicationConsistency(
      report(),
      {
        ...releasedMetadata,
        conceptDoi: "10.5281/zenodo.20",
      },
      {
        versionDoi: doi({ status: "example-not-resolvable" }),
        conceptDoi: doi({
          input: "10.5281/zenodo.20",
          normalizedDoi: "10.5281/zenodo.20",
          doiKind: "version",
        }),
      },
    );
    expect(result.overridableCheckIds).toEqual(
      expect.arrayContaining(["version-doi-validity", "concept-doi-kind"]),
    );
  });

  it("fails a declared concept DOI that disagrees with version lineage", () => {
    const result = buildPublicationConsistency(
      report(),
      { ...releasedMetadata, conceptDoi: "10.5281/zenodo.99" },
      {
        versionDoi: doi({ discoveredConceptDoi: "10.5281/zenodo.20" }),
        conceptDoi: doi({
          input: "10.5281/zenodo.99",
          normalizedDoi: "10.5281/zenodo.99",
          doiKind: "concept",
        }),
      },
    );
    expect(result.overridableCheckIds).toContain("deposit-concept-doi");
  });

  it("normalizes and compares the deposit GitHub owner/repository", () => {
    const matching = buildPublicationConsistency(report(), releasedMetadata, {
      versionDoi: doi({
        recordRepositoryUrls: [`https://github.com/LAB/REVIEW.git/commit/${commit.toUpperCase()}`],
      }),
    });
    expect(matching.overridableCheckIds).not.toContain("deposit-repository");

    const divergent = buildPublicationConsistency(report(), releasedMetadata, {
      versionDoi: doi({
        recordRepositoryUrls: [`https://github.com/another/review/commit/${commit}`],
      }),
    });
    expect(divergent.overridableCheckIds).toContain("deposit-repository");
  });
});
