import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson } from "@oratlas/contracts";
import { type PrismaClient } from "@oratlas/db";
import type * as IdentityLifecycle from "./node-identity-lifecycle";
import type * as NodePublication from "./node-publication";

vi.mock("server-only", () => ({}));

const databasePath = resolve(
  process.cwd(),
  "packages/db/prisma",
  `.tmp-oratlas-node-identity-${process.pid}-${Date.now()}.db`,
);
const databaseUrl = `file:./${databasePath.split(/[\\/]/).at(-1)}`;

let prisma: PrismaClient;
let lifecycle: typeof IdentityLifecycle;
let publication: typeof NodePublication;
let editor: { id: string; role: string };
let reader: { id: string; role: string };
let sourceNodeId: string;
let targetNodeId: string;
let rejectTargetNodeId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  const require = createRequire(import.meta.url);
  const prismaPackage = require.resolve("prisma/package.json", {
    paths: [resolve(process.cwd(), "packages/db")],
  });
  const prismaCli = resolve(dirname(prismaPackage), "build/index.js");
  try {
    execFileSync(
      process.execPath,
      [prismaCli, "db", "push", "--schema", "packages/db/prisma/schema.prisma", "--skip-generate"],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, stdio: "pipe" },
    );
  } catch (error) {
    if (process.platform !== "win32") throw error;
    const ddl = execFileSync(
      process.execPath,
      [
        prismaCli,
        "migrate",
        "diff",
        "--from-empty",
        "--to-schema-datamodel",
        "packages/db/prisma/schema.prisma",
        "--script",
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8" },
    );
    execFileSync("sqlite3", [databasePath], { input: ddl, stdio: ["pipe", "pipe", "pipe"] });
  }
  ({ prisma } = await import("./db"));
  lifecycle = await import("./node-identity-lifecycle");
  publication = await import("./node-publication");
  const editorRow = await prisma.user.create({
    data: { githubUserId: "identity-editor", githubLogin: "identity-editor", role: "EDITOR" },
  });
  const readerRow = await prisma.user.create({
    data: { githubUserId: "identity-reader", githubLogin: "identity-reader", role: "USER" },
  });
  editor = { id: editorRow.id, role: editorRow.role };
  reader = { id: readerRow.id, role: readerRow.role };

  sourceNodeId = await createPublishedClaim(
    "source-lab",
    "source-review",
    "claim-source",
    "Daily treatment improves overall survival among adults after twelve months.",
    "a",
  );
  targetNodeId = await createPublishedClaim(
    "target-lab",
    "target-review",
    "claim-target",
    "DAILY treatment improves overall survival among adults after twelve months!",
    "b",
  );
  rejectTargetNodeId = await createPublishedClaim(
    "third-lab",
    "third-review",
    "claim-third",
    "Daily treatment improves overall survival among adults after twelve months!",
    "c",
  );
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe.sequential("same-claim editorial lifecycle", () => {
  it("materializes deterministic proposals without merging nodes", async () => {
    const nodeCount = await prisma.knowledgeNode.count();
    const proposalIds = await prisma.$transaction((tx) =>
      lifecycle.materializeSameClaimProposals(tx, [targetNodeId, rejectTargetNodeId]),
    );
    expect(proposalIds.length).toBeGreaterThanOrEqual(2);
    expect(await prisma.knowledgeNode.count()).toBe(nodeCount);
    expect(await lifecycle.listPendingNodeIdentityProposals()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          signals: expect.arrayContaining(["normalized-text-hash"]),
        }),
      ]),
    );
  });

  it("allows only an editor to confirm or reject and audits both outcomes", async () => {
    const proposals = await lifecycle.listPendingNodeIdentityProposals();
    const confirmed = proposals.find(
      (proposal) =>
        [proposal.source.nodeId, proposal.target.nodeId].includes(sourceNodeId) &&
        [proposal.source.nodeId, proposal.target.nodeId].includes(targetNodeId),
    )!;
    await expect(
      lifecycle.decideNodeIdentityProposal(reader, confirmed.id, {
        decision: "confirm",
        expectedRevision: 0,
        note: "A non-editor must not publish this identity.",
      }),
    ).rejects.toThrow("Editor role required");
    const decision = {
      decision: "confirm" as const,
      expectedRevision: 0,
      note: "Editor verified the normalized statements and scientific scope.",
    };
    expect(await lifecycle.decideNodeIdentityProposal(editor, confirmed.id, decision)).toEqual({
      status: "confirmed",
      revision: 1,
      idempotent: false,
    });
    expect(await lifecycle.decideNodeIdentityProposal(editor, confirmed.id, decision)).toEqual({
      status: "confirmed",
      revision: 1,
      idempotent: true,
    });

    const reject = (await lifecycle.listPendingNodeIdentityProposals()).find((proposal) =>
      [proposal.source.nodeId, proposal.target.nodeId].includes(rejectTargetNodeId),
    )!;
    await lifecycle.decideNodeIdentityProposal(editor, reject.id, {
      decision: "reject",
      expectedRevision: 0,
      note: "Editor rejected this pair after comparing its declared scope.",
    });
    expect(
      await prisma.auditEvent.findMany({
        where: { subjectType: "node-identity-proposal" },
        select: { action: true },
        orderBy: { action: "asc" },
      }),
    ).toEqual([{ action: "node-identity.confirmed" }, { action: "node-identity.rejected" }]);
  });

  it("publishes confirmed identity on both node and claim-passport projections only", async () => {
    const source = await publication.getPublicNode(sourceNodeId);
    const target = await publication.getPublicNode(targetNodeId);
    expect(source?.sameClaims).toEqual([
      expect.objectContaining({ nodeId: targetNodeId, reviewAssertions: [expect.any(Object)] }),
    ]);
    expect(target?.sameClaims).toEqual([
      expect.objectContaining({ nodeId: sourceNodeId, reviewAssertions: [expect.any(Object)] }),
    ]);
    expect(source?.sameClaims.some((claim) => claim.nodeId === rejectTargetNodeId)).toBe(false);
    expect(await prisma.claimEvidenceRelation.count()).toBe(0);
  });
});

async function createPublishedClaim(
  owner: string,
  slug: string,
  localNodeId: string,
  statement: string,
  hashChar: string,
): Promise<string> {
  const repository = await prisma.repository.create({
    data: { owner, name: "review", canonicalUrl: `https://github.com/${owner}/review` },
  });
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: repository.id,
      commitSha: hashChar.repeat(40),
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: hashChar.repeat(64),
    },
  });
  const review = await prisma.review.create({
    data: {
      repositoryId: repository.id,
      currentSnapshotId: snapshot.id,
      slug,
      title: `${owner} review`,
      status: "published",
    },
  });
  const reviewVersion = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot.id,
      title: `${owner} review`,
      metadataJson: canonicalJson({ keywords: [], domains: [] }),
      publicState: "published",
      publishedAt: new Date(),
    },
  });
  const node = await prisma.knowledgeNode.create({
    data: { repositoryId: repository.id, localNodeId, kind: "claim" },
  });
  await prisma.knowledgeNodeVersion.create({
    data: {
      knowledgeNodeId: node.id,
      snapshotId: snapshot.id,
      title: statement,
      contributorsJson: "[]",
      license: "CC-BY-4.0",
      provenanceJson: canonicalJson({
        sourcePath: `claims/${localNodeId}.json`,
        repositoryUrl: repository.canonicalUrl,
      }),
      payloadJson: canonicalJson({ statement, qualifiers: [] }),
    },
  });
  await prisma.claim.create({
    data: {
      reviewVersionId: reviewVersion.id,
      knowledgeNodeId: node.id,
      localClaimId: localNodeId,
      text: statement,
      normalizedText: statement.toLowerCase(),
    },
  });
  return node.id;
}
