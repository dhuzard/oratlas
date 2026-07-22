import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

const database = vi.hoisted(() => ({
  indexReviews: [] as unknown[],
  detailReview: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("./db.js", () => ({
  prisma: {
    review: {
      findMany: vi.fn(async () => database.indexReviews),
      findUnique: vi.fn(async () => database.detailReview),
    },
  },
  parseJsonColumn(value: string, fallback: unknown) {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
}));

import { globalCitationId, globalClaimId, type TrustVerificationState } from "@oratlas/contracts";
import { buildEvidencePacket, prepareEvidencePacket } from "@oratlas/knowledge";
import {
  reviewedTrustSubjectHash,
  trustSubjectInputFromDatabaseRows,
  type DatabaseTrustAssessmentRow,
  type DatabaseTrustSubjectRows,
} from "@oratlas/trust";
import { buildKnowledgeIndex } from "./index-builder.js";
import { directEditorialDecisionHash } from "./decision-provenance.js";
import { getReviewDetail } from "./reviews.js";
import { TrustDisplay } from "../components/TrustDisplay.js";

const now = new Date("2026-07-01T00:00:00.000Z");
const expectedStates: TrustVerificationState[] = [
  "platform-verified",
  "stale-verification",
  "unverified-import",
  "legacy-unknown",
];

interface VerificationFixture {
  status: string;
  assessmentHash: string;
  reviewerRoleSnapshot: string;
  rationale: string;
  reviewer: { githubLogin: string };
}

interface AssessmentFixture extends DatabaseTrustAssessmentRow {
  claimEvidenceRelationId: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  verification: VerificationFixture | null;
}

type CitationFixture = DatabaseTrustSubjectRows["citation"] & { rawCitationJson: string };

type RelationFixture = DatabaseTrustSubjectRows["relation"] & {
  claimId: string;
  citationId: string;
  humanReviewed: boolean;
  citation: CitationFixture;
  trustAssessments: AssessmentFixture[];
};

type ClaimFixture = DatabaseTrustSubjectRows["claim"] & {
  createdAt: Date;
  evidenceRelations: RelationFixture[];
};

function buildAssessment(
  state: TrustVerificationState,
  relation: RelationFixture,
  claim: ClaimFixture,
  citation: CitationFixture,
): AssessmentFixture {
  const isLegacy = state === "legacy-unknown";
  const sourceClaimsHumanReview = state === "unverified-import";
  const assessment: AssessmentFixture = {
    id: `assessment-${claim.reviewVersionId}-${state}`,
    claimEvidenceRelationId: relation.id,
    protocolVersion: "trust-poc-1.0",
    assessorType: sourceClaimsHumanReview ? "human" : "agent",
    assessorId: sourceClaimsHumanReview ? "repository-reviewer" : "repository-agent",
    assessedAt: now,
    identityIntegrity: null,
    entailment: JSON.stringify({
      rating: "high",
      status: "assessed",
      rationale: `Evidence fixture for ${state}.`,
    }),
    sourceAccess: null,
    populationRelevance: null,
    interventionExposureRelevance: null,
    outcomeRelevance: null,
    methodologicalSafeguards: null,
    statisticalSafeguards: null,
    replicationConvergence: null,
    conflictDependency: null,
    limitationsJson: "[]",
    evidenceJson: JSON.stringify({ pointer: `${state}.json:1` }),
    aggregateScore: null,
    aggregateMethod: null,
    // A legacy row may contain a privileged-looking value. It still fails closed.
    reviewStatus: isLegacy ? "human-reviewed" : "unverified-import",
    sourceRecordJson: isLegacy ? null : JSON.stringify({ reviewStatus: "human-reviewed" }),
    sourceReviewStatus: isLegacy ? null : "human-reviewed",
    sourceAssessorType: isLegacy ? null : sourceClaimsHumanReview ? "human" : "agent",
    sourceAssessorId: isLegacy ? null : "repository-reviewer",
    sourceAssessedAt: isLegacy ? null : now,
    sourceEvidenceJson: isLegacy ? null : JSON.stringify({ pointer: `${state}.json:1` }),
    sourceAggregateScore: null,
    sourceAggregateMethod: null,
    sourceRelationHumanReviewed: isLegacy ? null : true,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    verification: null,
  };

  if (state === "platform-verified" || state === "stale-verification") {
    const currentHash = reviewedTrustSubjectHash(
      trustSubjectInputFromDatabaseRows({ assessment, relation, claim, citation }),
    );
    assessment.verification = {
      status: "human-reviewed",
      assessmentHash: state === "platform-verified" ? currentHash : "0".repeat(64),
      reviewerRoleSnapshot: "EDITOR",
      rationale: "Atlas editor checked the exact structural subject.",
      reviewer: { githubLogin: "atlas-editor" },
    };
  }

  return assessment;
}

function buildEvidence(versionId: string, state: TrustVerificationState, position: number) {
  const localClaimId = `claim-${state}`;
  const localCitationId = `citation-${state}`;
  const citation: CitationFixture = {
    id: `db-citation-${versionId}-${position}`,
    reviewVersionId: versionId,
    localCitationId,
    doi: `10.1000/${versionId}.${position}`,
    pmid: null,
    openAlexId: null,
    title: `Citation for ${state}`,
    authorsJson: "[]",
    year: 2025,
    source: "Fixture Journal",
    url: null,
    rawCitationJson: "{}",
  };
  const claim: ClaimFixture = {
    id: `db-claim-${versionId}-${position}`,
    reviewVersionId: versionId,
    localClaimId,
    text: `Evidence statement carrying ${state}.`,
    normalizedText: `evidence statement carrying ${state}`,
    section: "Results",
    anchor: `repository-${state}`,
    claimType: "empirical",
    qualification: null,
    createdAt: now,
    evidenceRelations: [],
  };
  const relation: RelationFixture = {
    id: `relation-${versionId}-${position}`,
    claimId: claim.id,
    citationId: citation.id,
    relationType: "supports",
    supportDirection: "positive",
    sourceLocation: `relations.jsonl:${position + 1}`,
    extractionMethod: "repository-import",
    extractionConfidence: 0.9,
    // Repository-authored flags are deliberately hostile fixture input.
    humanReviewed: true,
    citation,
    trustAssessments: [],
  };
  relation.trustAssessments = [buildAssessment(state, relation, claim, citation)];
  claim.evidenceRelations = [relation];
  return { claim, citation };
}

function buildVersion(versionId: string, semanticVersion: string, createdAt: Date, commit: string) {
  const evidence = expectedStates.map((state, position) =>
    buildEvidence(versionId, state, position),
  );
  return {
    id: versionId,
    reviewId: "review-trust-history",
    snapshotId: `snapshot-${versionId}`,
    semanticVersion,
    title: `TRUST history ${semanticVersion}`,
    abstract: "A versioned evidence fixture.",
    metadataJson: JSON.stringify({ keywords: ["evidence"], domains: ["Testing"] }),
    versionDoi: null,
    conceptDoi: null,
    zenodoRecordId: null,
    releaseTag: `v${semanticVersion}`,
    isExample: false,
    publicState: "published",
    publishedAt: createdAt,
    createdAt,
    contributors: [],
    identifiers: [],
    snapshot: {
      id: `snapshot-${versionId}`,
      repositoryId: "repository-1",
      commitSha: commit,
      branch: "main",
      releaseTag: `v${semanticVersion}`,
      releaseUrl: `https://github.com/example/review/releases/tag/v${semanticVersion}`,
      sourceCreatedAt: createdAt,
      capturedAt: createdAt,
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      manifestJson: null,
      contentHash: createHash("sha256").update(versionId).digest("hex"),
      repository: {
        id: "repository-1",
        host: "github.com",
        owner: "example",
        name: "review",
        canonicalUrl: "https://github.com/example/review",
        defaultBranch: "main",
        pagesUrl: null,
      },
    },
    claims: evidence.map(({ claim }) => claim),
    citations: evidence.map(({ citation }) => citation),
    sourceSubmission: {
      editorialOverrides: [],
      decisionProvenance: null,
      reviewer: null,
      reviewRounds: [],
      reviewedAt: null,
      updatedAt: createdAt,
    },
  };
}

function buildDatabaseFixture() {
  const current = buildVersion(
    "version-current",
    "2.0.0",
    new Date("2026-07-01T00:00:00.000Z"),
    "a".repeat(40),
  );
  const historical = buildVersion(
    "version-historical",
    "1.0.0",
    new Date("2025-07-01T00:00:00.000Z"),
    "b".repeat(40),
  );
  const base = {
    id: "review-trust-history",
    slug: "trust-history",
    currentSnapshotId: current.snapshot.id,
    title: current.title,
    abstract: current.abstract,
    reviewType: "computational-literature-review",
    licenseSpdx: "CC-BY-4.0",
    publishedReviewUrl: null,
    status: "published",
    acceptedAt: current.publishedAt,
    createdAt: historical.createdAt,
    updatedAt: current.createdAt,
    lifecycleRevision: 0,
  };
  return {
    indexReview: { ...base, versions: [current] },
    detailReview: { ...base, versions: [current, historical], lifecycleEvents: [] },
  };
}

function stateMap(
  claims: Array<{
    localClaimId: string;
    relations: Array<{
      trust?: { reviewStatus: string; verificationState: TrustVerificationState };
    }>;
  }>,
) {
  return Object.fromEntries(
    claims.map((claim) => [claim.localClaimId.replace("claim-", ""), claim.relations[0]?.trust]),
  );
}

beforeEach(() => {
  const fixture = buildDatabaseFixture();
  database.indexReviews = [fixture.indexReview];
  database.detailReview = fixture.detailReview;
});

describe("versioned evidence and TRUST integration", () => {
  it("fails closed when direct editorial decision provenance is tampered", async () => {
    const fixture = buildDatabaseFixture();
    const provenance = {
      id: "decision-provenance-1",
      submissionId: "submission-1",
      actorGithubLoginSnapshot: "decision-editor",
      actorRoleSnapshot: "EDITOR",
      decision: "accept",
      noteHash: null,
      conflictOfInterestStatus: "none-declared",
      administratorOverride: false,
      administratorOverrideGithubLoginSnapshot: null,
      administratorOverrideAt: null,
      createdAt: now,
      decisionHash: directEditorialDecisionHash({
        submissionId: "submission-1",
        actor: { githubLogin: "decision-editor", role: "EDITOR" },
        decision: "accept",
        noteHash: null,
        conflictOfInterest: { status: "none-declared" },
        override: null,
      }),
    };
    (
      fixture.detailReview.versions[0]!.sourceSubmission as unknown as {
        decisionProvenance: typeof provenance;
      }
    ).decisionProvenance = provenance;
    database.detailReview = fixture.detailReview;
    expect((await getReviewDetail("trust-history"))?.version.editorialDecision).toMatchObject({
      actorLogin: "decision-editor",
      decisionHash: provenance.decisionHash,
    });

    provenance.decisionHash = "0".repeat(64);
    expect((await getReviewDetail("trust-history"))?.version.editorialDecision).toBeUndefined();
  });

  it("deny-lists private verification and editorial-override fields from the public detail", async () => {
    const fixture = buildDatabaseFixture();
    const privateVerificationRationale = "PRIVATE-VERIFICATION-RATIONALE";
    const privateOverrideRationale = "PRIVATE-EDITORIAL-OVERRIDE-RATIONALE";
    const privateRoleSnapshot = "PRIVATE-REVIEWER-ROLE-SNAPSHOT";
    const assessment =
      fixture.detailReview.versions[0]!.claims[0]!.evidenceRelations[0]!.trustAssessments[0]!;
    if (!assessment.verification) throw new Error("Expected verified assessment fixture.");
    assessment.verification.rationale = privateVerificationRationale;
    assessment.verification.reviewerRoleSnapshot = privateRoleSnapshot;
    (
      fixture.detailReview.versions[0]!.sourceSubmission.editorialOverrides as Array<{
        checkId: string;
        rationale: string;
        editor: { githubLogin: string };
        createdAt: Date;
      }>
    ).push({
      checkId: "release-tag",
      rationale: privateOverrideRationale,
      editor: { githubLogin: "override-editor" },
      createdAt: now,
    });
    database.detailReview = fixture.detailReview;

    const detail = await getReviewDetail("trust-history");
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain(privateVerificationRationale);
    expect(serialized).not.toContain(privateOverrideRationale);
    expect(serialized).not.toContain(privateRoleSnapshot);

    const verification = detail?.claims[0]?.relations[0]?.trust?.platformVerification;
    expect(verification).toEqual({ reviewerLogin: "atlas-editor" });
    expect(verification).not.toHaveProperty("rationale");
    expect(verification).not.toHaveProperty("reviewerRoleSnapshot");
    expect(detail?.version.editorialOverrides).toEqual([
      {
        checkId: "release-tag",
        editorLogin: "override-editor",
        createdAt: now.toISOString(),
      },
    ]);
    expect(detail?.version.editorialOverrides[0]).not.toHaveProperty("rationale");
  });

  it("returns and renders every assessment in deterministic non-rating order", async () => {
    const fixture = buildDatabaseFixture();
    const relation = fixture.detailReview.versions[0]!.claims[0]!.evidenceRelations[0]!;
    const first = relation.trustAssessments[0]!;
    relation.trustAssessments.push({
      ...structuredClone(first),
      id: "assessment-second",
      protocolVersion: "trust-independent-2.0",
      assessorType: "human",
      assessorId: "second-reviewer",
      assessedAt: new Date("2026-07-03T00:00:00.000Z"),
      entailment: JSON.stringify({ rating: "not-assessed", status: "not-assessed" }),
      sourceAggregateScore: 0.42,
      sourceAggregateMethod: null,
      verification: null,
    });
    database.detailReview = fixture.detailReview;

    const detail = await getReviewDetail("trust-history");
    const output = detail?.claims[0]?.relations[0];
    expect(output?.trust).toBeUndefined();
    expect(output?.trusts.map((assessment) => assessment.assessmentId)).toEqual([
      first.id,
      "assessment-second",
    ]);
    expect(output?.trusts.map((assessment) => assessment.verificationState)).toEqual([
      "platform-verified",
      "unverified-import",
    ]);
    expect(output?.trusts.every((assessment) => assessment.criteria.length === 10)).toBe(true);
    expect(output?.trusts[1]?.criteria.find((row) => row.criterion === "entailment")).toMatchObject(
      {
        rating: "not-assessed",
        status: "not-assessed",
      },
    );
    expect(
      output?.trusts[1]?.criteria.find((row) => row.criterion === "sourceAccess"),
    ).toMatchObject({ rating: "not-supplied", status: "not-supplied" });
    const html = output?.trusts.map((trust) =>
      renderToStaticMarkup(createElement(TrustDisplay, { trust })),
    );
    expect(html?.join(" ")).toContain("second-reviewer");
    expect(html?.join(" ")).toContain("trust-independent-2.0");
    expect(html).toHaveLength(2);
    expect(html![0]!.match(/role="row"/g)).toHaveLength(11);
    expect(html![1]!.match(/role="row"/g)).toHaveLength(11);
    expect(html?.[1]).toContain("aggregate without an aggregation method");
    expect(html?.[1]).not.toContain("0.42");
    expect(html?.join(" ")).not.toContain('role="progressbar"');
  });

  it("carries all fail-closed verification states into exact globally-scoped packets", async () => {
    const index = await buildKnowledgeIndex();
    const packet = buildEvidencePacket(index, "evidence", {
      now: () => new Date("2026-07-02T00:00:00.000Z"),
    });
    const states = stateMap(packet.claims);

    expect(states).toMatchObject({
      "platform-verified": {
        reviewStatus: "human-reviewed",
        verificationState: "platform-verified",
      },
      "stale-verification": {
        reviewStatus: "unverified-import",
        verificationState: "stale-verification",
      },
      "unverified-import": {
        reviewStatus: "unverified-import",
        verificationState: "unverified-import",
      },
      "legacy-unknown": {
        reviewStatus: "unverified-import",
        verificationState: "legacy-unknown",
      },
    });
    expect(index.reviews[0]?.hasHumanReviewedTrust).toBe(true);
    expect(packet.claims[0]?.relations[0]?.trustAssessments?.[0]).toMatchObject({
      assessmentId: expect.any(String),
      protocolVersion: expect.any(String),
      assessorType: expect.any(String),
      assessorId: expect.any(String),
      assessedAt: expect.any(String),
    });

    for (const claim of packet.claims) {
      expect(claim.claimId).toBe(globalClaimId("version-current", claim.localClaimId));
      const relation = claim.relations[0];
      expect(relation?.citationId).toBe(
        globalCitationId("version-current", `citation-${relation?.trust?.verificationState}`),
      );
    }

    const prepared = prepareEvidencePacket(packet);
    expect(prepared.sha256).toBe(createHash("sha256").update(prepared.json, "utf8").digest("hex"));
    expect(prepared.json).toContain('"verificationState":"stale-verification"');

    const changed = structuredClone(packet);
    const changedTrust = changed.claims[0]?.relations[0]?.trust;
    if (!changedTrust) throw new Error("Expected TRUST fixture in evidence packet.");
    changedTrust.verificationState = "stale-verification";
    changedTrust.reviewStatus = "unverified-import";
    expect(prepareEvidencePacket(changed).sha256).not.toBe(prepared.sha256);
  });

  it("preserves the same states and version-scoped ids on immutable historical views", async () => {
    const detail = await getReviewDetail("trust-history", "version-historical");
    if (!detail) throw new Error("Expected historical review detail.");
    const states = stateMap(detail.claims);

    expect(detail.version.id).toBe("version-historical");
    expect(detail.versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "version-current", isCurrent: true }),
        expect.objectContaining({ id: "version-historical", isCurrent: false }),
      ]),
    );
    expect(Object.values(states).map((trust) => trust?.verificationState)).toEqual(
      expect.arrayContaining(expectedStates),
    );

    for (const claim of detail.claims) {
      expect(claim.claimId).toBe(globalClaimId("version-historical", claim.localClaimId));
      expect(claim.claimId).not.toBe(globalClaimId("version-current", claim.localClaimId));
    }
    for (const citation of detail.citations) {
      expect(citation.citationId).toBe(
        globalCitationId("version-historical", citation.localCitationId),
      );
    }

    const sourceOnly = detail.claims.find(
      (claim) => claim.localClaimId === "claim-unverified-import",
    )?.relations[0];
    expect(sourceOnly).toMatchObject({
      humanReviewed: false,
      trust: {
        reviewStatus: "unverified-import",
        verificationState: "unverified-import",
        sourceAssertion: {
          reviewStatus: "human-reviewed",
          relationHumanReviewed: true,
        },
      },
    });
    expect(sourceOnly?.trust?.platformVerification).toBeUndefined();
  });
});
