import { getPrisma } from "@oratlas/db";

const prisma = getPrisma();

const COMMIT_SHA = "7".repeat(40);
const TREE_SHA = "8".repeat(40);

export interface ArtifactOutcomeFixtureInput {
  caseName: string;
  compatibilityReport?: unknown;
  claimCount?: number;
}

export interface ArtifactOutcomeFixture {
  slug: string;
  dispose(): Promise<void>;
}

/**
 * Create the smallest immutable public review needed to exercise artifact-outcome
 * rendering. The fixture writes no claims, so every visible claim state comes
 * from the persisted compatibility report rather than incidental seed data.
 */
export async function createArtifactOutcomeFixture(
  input: ArtifactOutcomeFixtureInput,
): Promise<ArtifactOutcomeFixture> {
  const nonce = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const key = `${input.caseName}-${nonce}`.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const slug = `artifact-outcome-${key}`;
  const canonicalUrl = `https://github.com/e2e-artifacts/${key}`;
  const { repository, snapshot, review, version } = await prisma.$transaction(async (tx) => {
    const repository = await tx.repository.create({
      data: {
        owner: "e2e-artifacts",
        name: key,
        canonicalUrl,
        defaultBranch: "main",
        topicsJson: "[]",
      },
    });
    const snapshot = await tx.repositorySnapshot.create({
      data: {
        repositoryId: repository.id,
        commitSha: COMMIT_SHA,
        sourceTreeSha: TREE_SHA,
        sourceKind: "default-branch",
        branch: "main",
        inspectionStatus: "succeeded",
        inspectionReportJson: JSON.stringify({ schemaVersion: "1.0.0" }),
        contentHash: `e2e-artifact-outcome-${key}`,
      },
    });
    const review = await tx.review.create({
      data: {
        slug,
        repositoryId: repository.id,
        currentSnapshotId: snapshot.id,
        title: `Artifact outcome: ${input.caseName}`,
        abstract: "Deterministic offline Playwright fixture.",
        licenseSpdx: "CC-BY-4.0",
        status: "published",
        acceptedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    const version = await tx.reviewVersion.create({
      data: {
        reviewId: review.id,
        snapshotId: snapshot.id,
        sourceKind: "default-branch",
        sourceBranch: "main",
        sourceSelectionKey: `default-branch:${COMMIT_SHA}`,
        title: review.title,
        abstract: review.abstract,
        metadataJson: JSON.stringify({
          compatibilityLevel: "partially-compatible",
          ...(input.compatibilityReport === undefined
            ? {}
            : { compatibilityReport: input.compatibilityReport }),
        }),
        publishedAt: new Date("2026-07-01T00:00:00.000Z"),
        publicState: "published",
      },
    });
    if (input.claimCount) {
      await tx.claim.createMany({
        data: Array.from({ length: input.claimCount }, (_, index) => ({
          reviewVersionId: version.id,
          localClaimId: `claim-${index + 1}`,
          text: `Loaded fixture claim ${index + 1}.`,
          normalizedText: `loaded fixture claim ${index + 1}`,
        })),
      });
    }
    return { repository, snapshot, review, version };
  });

  return {
    slug,
    async dispose() {
      await prisma.claim.deleteMany({ where: { reviewVersionId: version.id } });
      await prisma.reviewVersion.deleteMany({ where: { id: version.id } });
      await prisma.review.deleteMany({ where: { id: review.id } });
      await prisma.repositorySnapshot.deleteMany({ where: { id: snapshot.id } });
      await prisma.repository.deleteMany({ where: { id: repository.id } });
    },
  };
}

type ArtifactName = "claims" | "citations" | "relations" | "trust" | "nodes" | "edges";
type ArtifactStatus = "not-declared" | "loaded" | "skipped" | "invalid";

interface ArtifactSourceFixture {
  path: string;
  discovery: "declared" | "discovered";
  status: ArtifactStatus;
  loadedCount: number;
  skippedCount: number | null;
  issues: Array<{ code: string; message: string }>;
}

export interface ArtifactOutcomeFixtureValue {
  status: ArtifactStatus;
  loadedCount: number;
  skippedCount: number | null;
  sources: ArtifactSourceFixture[];
}

const NOT_DECLARED: ArtifactOutcomeFixtureValue = {
  status: "not-declared",
  loadedCount: 0,
  skippedCount: 0,
  sources: [],
};

export const CLAIM_OUTCOME_CASES = {
  notDeclared: NOT_DECLARED,
  invalid: {
    status: "invalid",
    loadedCount: 0,
    skippedCount: 1,
    sources: [
      {
        path: "knowledge/claims.jsonl",
        discovery: "declared",
        status: "invalid",
        loadedCount: 0,
        skippedCount: 1,
        issues: [{ code: "schema-invalid", message: "Line 1 failed claim schema validation." }],
      },
    ],
  },
  loadedEmpty: {
    status: "loaded",
    loadedCount: 0,
    skippedCount: 0,
    sources: [
      {
        path: "knowledge/claims.jsonl",
        discovery: "declared",
        status: "loaded",
        loadedCount: 0,
        skippedCount: 0,
        issues: [],
      },
    ],
  },
  loadedWithSkips: {
    status: "loaded",
    loadedCount: 3,
    skippedCount: 1,
    sources: [
      {
        path: "knowledge/claims.jsonl",
        discovery: "declared",
        status: "loaded",
        loadedCount: 3,
        skippedCount: 1,
        issues: [
          {
            code: "record-skipped",
            message: "Line 4 was skipped after claim schema validation failed.",
          },
        ],
      },
    ],
  },
} satisfies Record<string, ArtifactOutcomeFixtureValue>;

export function compatibilityReportWithClaims(
  claims: ArtifactOutcomeFixtureValue,
): Record<string, unknown> {
  const signal = { detected: false, evidence: [] };
  const artifactOutcomes = Object.fromEntries(
    (["claims", "citations", "relations", "trust", "nodes", "edges"] as ArtifactName[]).map(
      (name) => [name, name === "claims" ? claims : NOT_DECLARED],
    ),
  );
  return {
    schemaVersion: "1.1.0",
    templateForkDetected: signal,
    templateFilesDetected: signal,
    mystProjectDetected: signal,
    bibliographyDetected: signal,
    reviewContentDetected: signal,
    provenanceDetected: signal,
    trustDataDetected: signal,
    releaseDetected: signal,
    doiDetected: signal,
    overallCompatibility: "partially-compatible",
    levelRationale: ["Deterministic artifact-outcome fixture."],
    blockingErrors: [],
    warnings: [],
    recommendations: [],
    artifactOutcomes,
  };
}

/** Old reports intentionally have no per-artifact outcome collection. */
export function legacyCompatibilityReport(): Record<string, unknown> {
  const signal = { detected: false, evidence: [] };
  return {
    schemaVersion: "1.0.0",
    templateForkDetected: signal,
    templateFilesDetected: signal,
    mystProjectDetected: signal,
    bibliographyDetected: signal,
    reviewContentDetected: signal,
    provenanceDetected: signal,
    trustDataDetected: signal,
    releaseDetected: signal,
    doiDetected: signal,
    overallCompatibility: "partially-compatible",
    levelRationale: ["Legacy fixture predates per-artifact outcomes."],
    blockingErrors: [],
    warnings: [],
    recommendations: [],
  };
}
