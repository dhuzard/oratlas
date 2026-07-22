import { describe, expect, it } from "vitest";
import {
  createCapturedFixtureTransport,
  inspectRepository,
  type CapturedRepositoryFixture,
} from "@oratlas/github";
import { normalizeImportedTrustRecord } from "@oratlas/trust";
import fixtureJson from "./fixtures/ethical-debt-v0.1.0-trust-preview.3/fixture.json" with { type: "json" };
import { runExtraction } from "./index.js";

const REPOSITORY_URL = "https://github.com/dhuzard/ethical-debt-AI-review";
const RELEASE_TAG = "v0.1.0-trust-preview.3";
const COMMIT_SHA = "955e2994e0c6a042be80851b2125c2064c211dcf";
const TREE_SHA = "095ceeb0ab7f5d9d3bc32f77869dcc856c707806";
const MANIFEST_SHA = "9f13f8dfc35cca0cf0a602b3304bcc0c9fe94e751c448d020b63e789f27abb23";
const ARTICLE_CHAPTER = "content/01_introduction.md";

const fixture = fixtureJson as CapturedRepositoryFixture;

async function replay() {
  const report = await inspectRepository(REPOSITORY_URL, {
    transport: createCapturedFixtureTransport(fixture),
    source: { kind: "release", tag: RELEASE_TAG },
    now: () => new Date(0),
  });
  return { report, extraction: runExtraction(report, () => new Date(0)) };
}

describe("frozen Ethical Debt release", () => {
  it("binds the bounded fixture to the approved immutable GitHub objects", () => {
    expect(fixture).toMatchObject({
      manifestSha256: MANIFEST_SHA,
      repository: { githubRepositoryId: "1291083149" },
      source: { commitSha: COMMIT_SHA, treeSha: TREE_SHA, releaseTag: RELEASE_TAG },
      pin: { kind: "release", value: RELEASE_TAG },
    });
    expect(Object.keys(fixture.files)).toHaveLength(11);
    expect(Object.values(fixture.files).reduce((total, file) => total + file.size, 0)).toBe(
      3_444_868,
    );
    expect(fixture.tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "TRUST.md",
          blobSha: "29db889ac19ca7ab33e3ae7bc7a8637614989aaf",
        }),
        expect.objectContaining({
          path: "FAIR.md",
          blobSha: "9d164253a351b9083efe2f71089500051ba1a2fb",
        }),
        expect.objectContaining({
          path: "review-manifest.json",
          blobSha: "39c8ee17291f211713d94554174eb63734ef2c44",
        }),
        expect.objectContaining({
          path: "knowledge/oratlas/trust-assessments.jsonl",
          blobSha: "c3058ec573eeebba32c502b71986ba5084a08778",
        }),
      ]),
    );
  });

  it("replays inspection and extraction fully offline without pretending uncaptured prose exists", async () => {
    const { report, extraction } = await replay();

    expect(report).toMatchObject({
      status: "succeeded",
      githubRepositoryId: "1291083149",
      warnings: [],
      selectedSource: { kind: "release", commitSha: COMMIT_SHA, treeSha: TREE_SHA },
    });
    expect(report.tree.some((entry) => entry.path === ARTICLE_CHAPTER)).toBe(true);
    expect(report.files).not.toHaveProperty(ARTICLE_CHAPTER);
    expect(extraction.metadata.fields.title?.value).toBe(
      "The Ethical Debt: Why wasting animal data is wasting animal lives",
    );
    expect(extraction.knowledge).toMatchObject({
      claims: expect.arrayContaining([expect.any(Object)]),
      citations: expect.arrayContaining([expect.any(Object)]),
      relations: expect.arrayContaining([expect.any(Object)]),
      trust: expect.arrayContaining([expect.any(Object)]),
      warnings: [],
    });
    expect({
      claims: extraction.knowledge.claims.length,
      citations: extraction.knowledge.citations.length,
      relations: extraction.knowledge.relations.length,
      trust: extraction.knowledge.trust.length,
    }).toEqual({ claims: 529, citations: 994, relations: 1_392, trust: 1_392 });
    expect(extraction.nodeExtraction.counts).toEqual({
      ok: 0,
      invalid: 0,
      skipped: 0,
      edgesOk: 0,
      edgesInvalid: 0,
      edgesSkipped: 0,
    });
    expect(extraction.compatibility).toMatchObject({
      overallCompatibility: "compatible",
      trustDataDetected: { detected: true },
      reviewContentDetected: { detected: true },
      facets: {
        article: {
          status: "partial",
          evidence: [
            "Review prose was detected in the repository tree, but no complete review prose was captured.",
          ],
        },
      },
    });

    const sourceTrust = extraction.knowledge.trust.find((record) => "claimId" in record);
    expect(sourceTrust).toBeDefined();
    if (!sourceTrust || !("claimId" in sourceTrust))
      throw new Error("Expected legacy TRUST record.");
    const imported = normalizeImportedTrustRecord(sourceTrust, false);
    expect(imported.reviewStatus).toBe("unverified-import");
    expect(imported.sourceReviewStatus).toBe(sourceTrust.reviewStatus);
    expect(imported.sourceRecordJson).toContain('"sourceRelationHumanReviewed":false');
  });

  it("preserves source methodology bytes without parsing them into Atlas ratings", async () => {
    const { extraction } = await replay();

    expect(extraction.sourceAssessmentDocuments?.documents).toEqual([
      expect.objectContaining({
        kind: "trust",
        path: "TRUST.md",
        status: "preserved",
        size: 2_883,
        contentHash: "087759f22e66aa7ee466a2de0189c322bec43f8e775ff586f359a93b053ef5b0",
      }),
      expect.objectContaining({
        kind: "fair",
        path: "FAIR.md",
        status: "preserved",
        size: 1_147,
        contentHash: "dd44ae72b9c76ee061e475990edc3aecb2990bb793afb557e3451ba6fac7d46c",
      }),
    ]);
    expect(extraction.metadata.fields).not.toHaveProperty("trust");
    expect(extraction.metadata.fields).not.toHaveProperty("fair");
  });
});
