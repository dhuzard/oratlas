import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createCapturedFixtureTransport,
  inspectRepository,
  type CapturedRepositoryFixture,
} from "@oratlas/github";
import { runExtraction } from "@oratlas/extractor";
import type { PrismaClient } from "@oratlas/db";
import crtJson from "../../../../packages/extractor/src/fixtures/ethical-debt-v0.1.0-trust-preview.3/fixture.json" with { type: "json" };
import ntsJson from "../../../../packages/extractor/src/fixtures/source-pilot/nts/fixture.json" with { type: "json" };
import hcmJson from "../../../../packages/extractor/src/fixtures/source-pilot/hcm/fixture.json" with { type: "json" };
import hcmReleaseJson from "../../../../packages/extractor/src/fixtures/source-pilot/hcm-release/fixture.json" with { type: "json" };

vi.mock("server-only", () => ({}));

// Offline editorial pilot only. Each source retains its exact capture and release/commit identity.
const cases = [
  { name: "CRT frozen release", fixture: crtJson, counts: [529, 994, 1392, 1392] },
  { name: "DiggyPaper NTS", fixture: ntsJson, counts: [4, 4, 4, 0] },
  { name: "Murmuration HCM", fixture: hcmJson, counts: [58, 5, 58, 0] },
  // Bounded structural export only: full report/matrix bytes remain uncaptured.
  { name: "Murmuration HCM exact release", fixture: hcmReleaseJson, counts: [58, 5, 58, 0] },
];
// Opt-in PostgreSQL callers must initialize a disposable dedicated schema and matching Prisma client.
const postgresUrl = process.env.SOURCE_PILOT_POSTGRES_TEST_DATABASE_URL;
const schemaDirectory = resolve("packages/db/prisma");
const directory = postgresUrl
  ? undefined
  : mkdtempSync(join(schemaDirectory, "oratlas-editorial-pilot-"));
const databaseUrl = postgresUrl ?? `file:./${basename(directory!)}/pilot.db`;
const previousDatabaseUrl = process.env.DATABASE_URL;
let prisma: PrismaClient;
let submitterId: string;
let editorId: string;
const accepted: string[] = [];

beforeAll(async () => {
  if (postgresUrl) {
    const url = new URL(postgresUrl);
    const schema = url.searchParams.get("schema");
    if (!["postgres:", "postgresql:"].includes(url.protocol) || !schema || schema === "public") {
      throw new Error("PostgreSQL pilot requires an explicit disposable non-public schema.");
    }
  }
  process.env.DATABASE_URL = databaseUrl;
  if (directory) {
    // Prisma's Windows schema engine requires the SQLite file to exist before db push.
    writeFileSync(join(directory, "pilot.db"), "", { flag: "wx" });
    execFileSync(
      process.execPath,
      [
        resolve("packages/db/node_modules/prisma/build/index.js"),
        "db",
        "push",
        "--schema",
        "packages/db/prisma/schema.prisma",
        "--skip-generate",
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
    );
  }
  prisma = (await import("./db")).prisma;
  expect(await prisma.reviewVersion.count()).toBe(0);
  submitterId = (
    await prisma.user.create({
      data: {
        githubUserId: "pilot-submitter",
        githubLogin: "pilot-submitter",
        role: "USER",
      },
    })
  ).id;
  editorId = (
    await prisma.user.create({
      data: {
        githubUserId: "pilot-editor",
        githubLogin: "pilot-editor",
        role: "EDITOR",
      },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (directory) {
    const cleanupTarget = resolve(directory);
    if (
      dirname(cleanupTarget) !== schemaDirectory ||
      !basename(cleanupTarget).startsWith("oratlas-editorial-pilot-")
    ) {
      throw new Error("Refusing cleanup outside the disposable pilot directory.");
    }
    rmSync(cleanupTarget, { recursive: true, force: true });
  }
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe.sequential("three-source disposable-DB editorial pilot (#264)", () => {
  it.each(cases)(
    "records the bounded editorial outcome for $name unchanged",
    async ({ fixture: json, counts }) => {
      const fixture = json as CapturedRepositoryFixture;
      const report = await inspectRepository(fixture.repository.canonicalUrl, {
        transport: createCapturedFixtureTransport(fixture),
        source:
          fixture.source.kind === "release"
            ? { kind: "release", tag: fixture.source.releaseTag! }
            : { kind: "default-branch" },
      });
      expect(report.selectedSource?.commitSha).toBe(fixture.source.commitSha);
      const extraction = runExtraction(report);
      expect([
        extraction.knowledge.claims.length,
        extraction.knowledge.citations.length,
        extraction.knowledge.relations.length,
        extraction.knowledge.trust.length,
      ]).toEqual(counts);
      const { buildValidationReport } = await import("./ingest");
      const validation = await buildValidationReport(
        report,
        extraction.compatibility,
        extraction.metadata,
        undefined,
        extraction.knowledge.claims.length > 0 && extraction.knowledge.citations.length > 0,
        extraction.knowledge.trust.length > 0,
        false,
      );
      // A refusal must identify the actual source condition; no fixture repairs or metadata overrides.
      expect(validation.hardErrors, JSON.stringify(validation)).toEqual([]);
      const { createInspectionCapture } = await import("./inspection-captures");
      const { createSubmission, acceptSubmission } = await import("./submissions");
      const capture = await createInspectionCapture(submitterId, report, extraction, validation);
      const submission = await createSubmission({ inspectionToken: capture.token, submitterId });
      if (json === hcmJson) {
        // This bounded capture selects the default branch while source metadata declares a release.
        await expect(acceptSubmission(submission.submissionId, editorId)).rejects.toThrow(
          "Explicit editor overrides are required for: source-release-tag.",
        );
        expect(
          await prisma.reviewVersion.count({
            where: {
              snapshot: { commitSha: fixture.source.commitSha },
            },
          }),
        ).toBe(0);
        return;
      }
      await acceptSubmission(submission.submissionId, editorId);
      const version = await prisma.reviewVersion.findFirstOrThrow({
        where: {
          snapshot: { commitSha: fixture.source.commitSha },
        },
      });
      accepted.push(version.id);
      expect(
        await Promise.all([
          prisma.claim.count({ where: { reviewVersionId: version.id } }),
          prisma.citation.count({ where: { reviewVersionId: version.id } }),
          prisma.claimEvidenceRelation.count({ where: { claim: { reviewVersionId: version.id } } }),
          prisma.trustAssessment.count({
            where: { relation: { claim: { reviewVersionId: version.id } } },
          }),
        ]),
      ).toEqual(counts);
      const claim = await prisma.claim.findFirstOrThrow({
        where: { reviewVersionId: version.id },
        orderBy: { localClaimId: "asc" },
      });
      const { GET } = await import("@/app/api/claims/[versionId]/[localClaimId]/route");
      const response = await GET(new Request("http://localhost/api/claims/pilot"), {
        params: Promise.resolve({ versionId: version.id, localClaimId: claim.localClaimId }),
      });
      expect(response.status).toBe(200);
      const passport = await response.json();
      expect(passport).toMatchObject({
        versionId: version.id,
        localClaimId: claim.localClaimId,
        text: claim.text,
      });
      expect(passport.evidence).toHaveLength(
        await prisma.claimEvidenceRelation.count({ where: { claimId: claim.id } }),
      );
      const graphApi = await import("@/app/api/graph/route");
      const graphResponse = await graphApi.GET(
        new Request(
          `http://localhost/api/graph?seed=${encodeURIComponent(claim.knowledgeNodeId!)}&direction=both&status=authoritative&limit=25`,
        ),
      );
      expect(graphResponse.status).toBe(200);
      const graph = await graphResponse.json();
      expect(graph.nodes).toContainEqual(
        expect.objectContaining({
          nodeId: claim.knowledgeNodeId,
          kind: "claim",
          text: claim.text,
        }),
      );
      expect(
        graph.edges.some(
          (edge: { sourceNodeId: string }) => edge.sourceNodeId === claim.knowledgeNodeId,
        ),
      ).toBe(true);
    },
    60_000,
  );

  it("does not infer cross-source evidence relations from acceptance", async () => {
    expect(accepted).toHaveLength(3);
    expect(await prisma.reviewVersion.count()).toBe(3);
    const relations = await prisma.claimEvidenceRelation.findMany({
      include: {
        claim: { select: { reviewVersionId: true } },
        citation: { select: { reviewVersionId: true } },
      },
    });
    expect(relations).toHaveLength(1454);
    expect(
      relations.every(
        (relation) => relation.claim.reviewVersionId === relation.citation.reviewVersionId,
      ),
    ).toBe(true);
    expect(await prisma.nodeEdge.count({ where: { status: "confirmed" } })).toBe(0);
    expect(await prisma.nodeIdentityProposal.count({ where: { status: "confirmed" } })).toBe(0);
  });
});
