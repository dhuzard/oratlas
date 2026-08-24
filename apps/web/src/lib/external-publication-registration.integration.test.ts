import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { canonicalJson, type PublicationType } from "@oratlas/contracts";
import { normalizeMystPublication, type VerifiedExternalPublication } from "@oratlas/publications";
import { applyDatabaseGuards, type PrismaClient } from "@oratlas/db";

vi.mock("server-only", () => ({}));

const databasePath = join(
  tmpdir(),
  `oratlas-external-registration-${process.pid}-${Date.now()}.db`,
);
const databaseUrl = `file:${databasePath.replaceAll("\\", "/")}?connection_limit=1`;
const observedAt = "2026-08-24T08:00:00.000Z";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

let prisma: PrismaClient;
let persist: (
  verified: VerifiedExternalPublication,
  actorId: string,
) => Promise<{
  captureId: string;
  publicationId: string;
  publicationVersionId: string;
  replayed: boolean;
}>;
let editorId: string;

function verifiedFixture(
  sourcesSha256 = sha("document-set-v1"),
  publicationType: PublicationType = "other",
): VerifiedExternalPublication {
  const claim = {
    schemaVersion: "0.2.0",
    id: "claim-1",
    text: "A captured claim.",
    target: { type: "myst-xref", identifier: "claim-1", htmlId: "claim-1" },
    source: {
      documentPath: "results.md",
      documentSha256: sha("source"),
      startLine: 1,
      endLine: 1,
      blockSha256: sha("block"),
    },
    selector: {
      representation: "oratlas-myst-source-utf8-v1",
      unit: "body",
      textQuote: { type: "TextQuoteSelector", exact: "A captured claim." },
      textPosition: { type: "TextPositionSelector", start: 0, end: 17 },
    },
    declarationSha256: sha("declaration"),
  };
  const manifest = {
    schemaVersion: "0.2.0",
    generator: { name: "@oratlas/myst", version: "0.2.0" },
    publication: {
      id: "stable-publication",
      canonicalUrl: "https://example.org/review/",
      version: { sourcesSha256 },
    },
    adapter: { type: "myst", xref: "myst.xref.json" },
    artifacts: {
      claims: {
        path: "oratlas/claims.jsonl",
        format: "jsonl",
        records: 1,
        sha256: sha(`${JSON.stringify(claim)}\n`),
        declarations: "publication-source",
      },
    },
  };
  const normalized = normalizeMystPublication({
    manifest,
    claims: [claim],
    publicationType,
    structuralProvenance: "published-structure",
    observedAt,
    registrationKey: "registration-key",
    verificationWarnings: [],
  });
  const manifestBytes = Buffer.from(`\ufeff${JSON.stringify(manifest)}`);
  const pageBytes = Buffer.from('{"mdast":{"type":"root","children":[]}}');
  return {
    manifest: manifest as VerifiedExternalPublication["manifest"],
    normalized,
    artifacts: [
      {
        artifactKind: "publication-manifest",
        requestedUrl: "https://example.org/review/oratlas.manifest.json",
        observedUrl: "https://example.org/review/oratlas.manifest.json",
        mediaType: "application/json",
        bytes: manifestBytes,
        contentSha256: sha(manifestBytes.toString("utf8")),
        provenance: { status: 200, redirects: [], headers: { etag: '"fixture"' } },
      },
      ...["pages/one.json", "pages/two.json"].map((declaredPath) => ({
        artifactKind: "published-page-data" as const,
        declaredPath,
        requestedUrl: `https://example.org/review/${declaredPath}`,
        observedUrl: `https://example.org/review/${declaredPath}`,
        mediaType: "application/json",
        bytes: pageBytes,
        contentSha256: sha(pageBytes.toString("utf8")),
        provenance: { status: 200, redirects: [], headers: { etag: '"shared-bytes"' } },
      })),
    ],
    warnings: [],
    resolvedClaimUrls: new Map([["claim-1", "https://example.org/review/#claim-1"]]),
  };
}

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  execFileSync(
    process.execPath,
    [
      resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
      "db",
      "push",
      "--schema",
      resolve(process.cwd(), "packages/db/prisma/schema.prisma"),
      "--skip-generate",
    ],
    { env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" }, stdio: "pipe" },
  );
  const database = await import("./db");
  prisma = database.prisma;
  await applyDatabaseGuards(prisma, "sqlite");
  const registration = await import("./external-publication-registration");
  persist = registration.persistVerifiedExternalPublication;
  const editor = await prisma.user.create({
    data: {
      githubUserId: "external-registration-editor",
      githubLogin: "external-editor",
      role: "EDITOR",
    },
  });
  editorId = editor.id;
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

describe("external publication registration persistence", () => {
  it("is replay-idempotent and creates a new immutable version when sources change", async () => {
    const first = await persist(verifiedFixture(), editorId);
    expect(first.replayed).toBe(false);
    const replay = await persist(verifiedFixture(), editorId);
    expect(replay.replayed).toBe(true);
    expect(replay.captureId).toBe(first.captureId);
    expect(replay.publicationVersionId).toBe(first.publicationVersionId);

    const conflicting = verifiedFixture();
    const conflictingBytes = Buffer.from('{"mdast":{"type":"root","changed":true}}');
    conflicting.artifacts[1] = {
      ...conflicting.artifacts[1]!,
      bytes: conflictingBytes,
      contentSha256: sha(conflictingBytes.toString("utf8")),
    };
    await expect(persist(conflicting, editorId)).rejects.toThrow(/immutable capture/);

    const changed = await persist(verifiedFixture(sha("document-set-v2")), editorId);
    expect(changed.replayed).toBe(false);
    expect(changed.publicationId).toBe(first.publicationId);
    expect(changed.publicationVersionId).not.toBe(first.publicationVersionId);

    expect(await prisma.publication.count()).toBe(1);
    expect(await prisma.publicationVersion.count()).toBe(2);
    expect(await prisma.publicationCapture.count()).toBe(6);
    expect(await prisma.publicationClaimOccurrence.count()).toBe(2);
    const equalByteCaptures = await prisma.publicationCapture.findMany({
      where: {
        publicationVersionId: first.publicationVersionId,
        artifactKind: "published-page-data",
      },
      orderBy: { declaredPath: "asc" },
    });
    expect(equalByteCaptures).toHaveLength(2);
    expect(equalByteCaptures.map(({ declaredPath }) => declaredPath)).toEqual([
      "pages/one.json",
      "pages/two.json",
    ]);
    expect(equalByteCaptures.map(({ requestedUrl }) => requestedUrl)).toEqual([
      "https://example.org/review/pages/one.json",
      "https://example.org/review/pages/two.json",
    ]);
    expect(
      equalByteCaptures.map(({ httpProvenanceJson }) => JSON.parse(httpProvenanceJson)),
    ).toEqual([
      { headers: { etag: '"shared-bytes"' }, redirects: [], status: 200 },
      { headers: { etag: '"shared-bytes"' }, redirects: [], status: 200 },
    ]);
    expect(new Set(equalByteCaptures.map(({ contentSha256 }) => contentSha256)).size).toBe(1);
    expect(
      new Set(equalByteCaptures.map(({ artifactIdentitySha256 }) => artifactIdentitySha256)).size,
    ).toBe(2);
    const capture = await prisma.publicationCapture.findUniqueOrThrow({
      where: { id: first.captureId },
    });
    expect(capture.requestedUrl).toBe("https://example.org/review/oratlas.manifest.json");
    expect(capture.observedUrl).toBe(capture.requestedUrl);
    expect(capture.contentBytes?.startsWith("\ufeff")).toBe(true);
    expect(capture.contentSha256).toBe(sha(capture.contentBytes!));
    expect(JSON.parse(capture.httpProvenanceJson)).toMatchObject({ status: 200 });
    expect(JSON.parse(canonicalJson(JSON.parse(capture.httpProvenanceJson)))).toMatchObject({
      status: 200,
    });
  });
});
