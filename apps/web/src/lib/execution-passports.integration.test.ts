import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  canonicalJson,
  EXECUTION_ATTESTATION_PAYLOAD_TYPE,
  globalClaimId,
  PROCESS_RUN_PROFILE,
  RO_CRATE_1_1_PROFILE,
  WORKFLOW_RO_PROFILE,
  WORKFLOW_RUN_PROFILE,
  type ExecutionAttestationStatement,
  type ExecutionPassportRegistration,
  type WorkflowRunCrate,
} from "@oratlas/contracts";
import { dssePae, executionKeyId } from "@oratlas/execution-passports";
import { type PrismaClient } from "@oratlas/db";
import type * as Passports from "./execution-passports";

vi.mock("server-only", () => ({}));

const externalDatabaseUrl = process.env.EXECUTION_PASSPORT_TEST_DATABASE_URL;
const databaseFilename = `oratlas-execution-passports-${process.pid}-${Date.now()}.db`;
const databasePath = externalDatabaseUrl
  ? undefined
  : resolve(process.cwd(), "packages/db/prisma", databaseFilename);
const databaseUrl = externalDatabaseUrl ?? `file:./${databaseFilename}`;
const databaseSchema = externalDatabaseUrl
  ? "packages/db/prisma/schema.postgres.prisma"
  : "packages/db/prisma/schema.prisma";
const commitSha = "a".repeat(40);
const treeSha = "b".repeat(40);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const keyId = executionKeyId(publicKey);
const signingIdentity = {
  issuer: "https://token.actions.githubusercontent.com",
  subject: "https://github.com/lab/review/.github/workflows/analysis.yml@refs/heads/main",
};

let prisma: PrismaClient;
let passports: typeof Passports;
let editor: { id: string; role: string };
let user: { id: string; role: string };
let versionId: string;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  process.env.EXECUTION_PASSPORT_TRUSTED_KEYS_JSON = JSON.stringify([
    { keyId, algorithm: "ed25519", publicKeyPem, ...signingIdentity },
  ]);
  const config = await import("@oratlas/config");
  config.resetServerEnvCache();
  execFileSync(
    process.execPath,
    [
      resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
      "db",
      "push",
      "--schema",
      databaseSchema,
      "--skip-generate",
    ],
    {
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        RUST_LOG: "info",
        RUST_BACKTRACE: "1",
      },
      stdio: "pipe",
    },
  );
  ({ prisma } = await import("./db"));
  passports = await import("./execution-passports");

  const editorRow = await prisma.user.create({
    data: { githubUserId: "passport-editor", githubLogin: "passport-editor", role: "EDITOR" },
  });
  const userRow = await prisma.user.create({
    data: { githubUserId: "passport-user", githubLogin: "passport-user", role: "USER" },
  });
  editor = { id: editorRow.id, role: editorRow.role };
  user = { id: userRow.id, role: userRow.role };
  const repository = await prisma.repository.create({
    data: {
      owner: "lab",
      name: "review",
      canonicalUrl: "https://github.com/lab/review",
    },
  });
  const snapshot = await prisma.repositorySnapshot.create({
    data: {
      repositoryId: repository.id,
      commitSha,
      sourceTreeSha: treeSha,
      inspectionStatus: "succeeded",
      inspectionReportJson: "{}",
      contentHash: digest("snapshot"),
    },
  });
  const review = await prisma.review.create({
    data: {
      slug: "passport-review",
      repositoryId: repository.id,
      currentSnapshotId: snapshot.id,
      title: "Passport review",
      status: "published",
    },
  });
  const version = await prisma.reviewVersion.create({
    data: {
      reviewId: review.id,
      snapshotId: snapshot.id,
      title: "Passport review",
      metadataJson: "{}",
      publicState: "published",
      publishedAt: new Date("2025-01-02T00:00:00.000Z"),
    },
  });
  versionId = version.id;
  await prisma.claim.create({
    data: {
      reviewVersionId: version.id,
      localClaimId: "claim-1",
      text: "The exact workflow output supports this claim.",
      normalizedText: "the exact workflow output supports this claim",
    },
  });
}, 60_000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (databasePath) {
    for (const path of [
      databasePath,
      `${databasePath}-journal`,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ]) {
      if (existsSync(path)) rmSync(path);
    }
  }
});

function executionPackage(localClaimId = "claim-1"): ExecutionPassportRegistration {
  const claimId = globalClaimId(versionId, localClaimId);
  const workflowSha = digest("workflow");
  const inputSha = digest("input");
  const outputSha = digest("output");
  const crate: WorkflowRunCrate = {
    "@context": [
      "https://w3id.org/ro/crate/1.1/context",
      "https://w3id.org/ro/terms/workflow-run/context",
    ],
    "@graph": [
      {
        "@id": "ro-crate-metadata.json",
        "@type": "CreativeWork",
        about: { "@id": "./" },
        conformsTo: [{ "@id": RO_CRATE_1_1_PROFILE }, { "@id": WORKFLOW_RO_PROFILE }],
      },
      {
        "@id": "./",
        "@type": "Dataset",
        name: "Run",
        conformsTo: [
          { "@id": WORKFLOW_RUN_PROFILE },
          { "@id": PROCESS_RUN_PROFILE },
          { "@id": WORKFLOW_RO_PROFILE },
        ],
        license: "MIT",
        mainEntity: { "@id": "workflow.yml" },
        mentions: [{ "@id": "#source" }, { "@id": "#run" }, { "@id": "#claim" }],
        hasPart: [{ "@id": "workflow.yml" }, { "@id": "input.txt" }, { "@id": "output.txt" }],
      },
      {
        "@id": WORKFLOW_RUN_PROFILE,
        "@type": "CreativeWork",
        name: "Workflow Run RO-Crate 0.5",
      },
      {
        "@id": PROCESS_RUN_PROFILE,
        "@type": "CreativeWork",
        name: "Process Run RO-Crate 0.5",
      },
      {
        "@id": WORKFLOW_RO_PROFILE,
        "@type": "CreativeWork",
        name: "Workflow RO-Crate 1.0",
      },
      {
        "@id": "#github-actions",
        "@type": "ComputerLanguage",
        name: "GitHub Actions workflow",
      },
      {
        "@id": "#source",
        "@type": "SoftwareSourceCode",
        codeRepository: "https://github.com/lab/analysis",
        commitSha,
        treeSha,
      },
      {
        "@id": "workflow.yml",
        "@type": ["File", "SoftwareSourceCode", "ComputationalWorkflow"],
        name: "workflow.yml",
        programmingLanguage: { "@id": "#github-actions" },
        workflowPath: "workflow.yml",
        sha256: workflowSha,
      },
      {
        "@id": "#run",
        "@type": "CreateAction",
        name: "Run 17",
        actionStatus: "https://schema.org/CompletedActionStatus",
        instrument: { "@id": "workflow.yml" },
        object: { "@id": "input.txt" },
        result: { "@id": "output.txt" },
        claimBindings: { "@id": "#claim" },
        runId: "17",
        runAttempt: 2,
      },
      {
        "@id": "input.txt",
        "@type": "File",
        name: "input.txt",
        sha256: inputSha,
        contentSize: 5,
        encodingFormat: "text/plain",
      },
      {
        "@id": "output.txt",
        "@type": "File",
        name: "output.txt",
        sha256: outputSha,
        contentSize: 6,
        encodingFormat: "text/plain",
      },
      {
        "@id": "#claim",
        "@type": "EvidenceBinding",
        name: "Claim binding",
        oratlasClaimId: claimId,
      },
    ],
  };
  const statement: ExecutionAttestationStatement = {
    schemaVersion: "1.0",
    predicateType: "https://oratlas.org/attestations/execution/v1",
    crateSha256: digest(canonicalJson(crate)),
    repository: { url: "https://github.com/lab/analysis", commitSha, treeSha },
    workflow: {
      entityId: "workflow.yml",
      path: "workflow.yml",
      sha256: workflowSha,
      runId: "17",
      runAttempt: 2,
    },
    claims: [{ versionId, localClaimId, claimId }],
    artifacts: [
      {
        entityId: "input.txt",
        role: "input",
        name: "input.txt",
        path: "input.txt",
        mediaType: "text/plain",
        byteSize: 5,
        sha256: inputSha,
      },
      {
        entityId: "output.txt",
        role: "output",
        name: "output.txt",
        path: "output.txt",
        mediaType: "text/plain",
        byteSize: 6,
        sha256: outputSha,
      },
    ],
    signingIdentity,
    issuedAt: "2025-01-01T00:00:00Z",
  };
  const payload = Buffer.from(canonicalJson(statement));
  return {
    crate,
    attestation: {
      payloadType: EXECUTION_ATTESTATION_PAYLOAD_TYPE,
      payload: payload.toString("base64"),
      signatures: [
        {
          keyId,
          sig: sign(
            null,
            dssePae(EXECUTION_ATTESTATION_PAYLOAD_TYPE, payload),
            privateKey,
          ).toString("base64"),
        },
      ],
    },
  };
}

describe.sequential("execution passport persistence", () => {
  it("authorizes editors, rejects unknown claims, and atomically audits registration", async () => {
    await expect(
      passports.registerExecutionPassport(user, executionPackage()),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      passports.registerExecutionPassport(editor, executionPackage("unknown-claim")),
    ).rejects.toMatchObject({ code: "not-found" });

    const registered = await passports.registerExecutionPassport(editor, executionPackage());
    expect(registered.status).toBe("execution-attested");
    expect(registered.verificationRevision).toBe(0);
    const row = await prisma.executionPassport.findUniqueOrThrow({
      where: { id: registered.id },
      include: { claims: true, artifacts: true },
    });
    expect(row.claims).toHaveLength(1);
    expect(row.artifacts.map((artifact) => artifact.role).sort()).toEqual(["input", "output"]);
    expect(
      await prisma.auditEvent.count({
        where: { action: "execution-passport.registered", subjectId: registered.id },
      }),
    ).toBe(1);

    const replay = executionPackage();
    replay.attestation.signatures.push({
      keyId: "f".repeat(64),
      sig: Buffer.alloc(64, 7).toString("base64"),
    });
    await expect(passports.registerExecutionPassport(editor, replay)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(await prisma.executionPassport.count()).toBe(1);
  });

  it("serves a re-verified public projection and records CAS re-verification", async () => {
    const row = await prisma.executionPassport.findFirstOrThrow();
    const publicRecord = await passports.getPublicExecutionPassport(row.id);
    expect(publicRecord?.status).toBe("execution-attested");
    expect(publicRecord?.issuedAt).toBe("2025-01-01T00:00:00.000Z");
    expect(publicRecord).not.toHaveProperty("registeredBy");
    expect(publicRecord?.crate).toBeDefined();
    expect(publicRecord?.limitation).toContain("does not mean");
    expect(await passports.listExecutionPassportsForClaim(versionId, "claim-1")).toHaveLength(1);

    const result = await passports.reverifyExecutionPassport(editor, row.id, 0);
    expect(result.verificationRevision).toBe(1);
    await expect(passports.reverifyExecutionPassport(editor, row.id, 0)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      await prisma.auditEvent.count({
        where: { action: "execution-passport.verified", subjectId: row.id },
      }),
    ).toBe(1);
  });

  it("fails public reads closed when a materialized digest is altered", async () => {
    const row = await prisma.executionPassport.findFirstOrThrow({ include: { artifacts: true } });
    await prisma.executionPassportArtifact.update({
      where: { id: row.artifacts[0]!.id },
      data: { sha256: digest("tampered materialized row") },
    });
    expect(await passports.getPublicExecutionPassport(row.id)).toBeNull();
    await expect(passports.reverifyExecutionPassport(editor, row.id, 1)).rejects.toMatchObject({
      code: "conflict",
    });
    expect(
      (await prisma.executionPassport.findUniqueOrThrow({ where: { id: row.id } }))
        .verificationStatus,
    ).toBe("failed");
  });
});
