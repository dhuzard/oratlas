import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrisma, materializePublicationClaimOccurrence, type PrismaClient } from "@oratlas/db";

const databaseName = `oratlas-synthetic-publication-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages/db/prisma", databaseName);
// Prisma resolves relative SQLite URLs from the directory containing schema.prisma.
const databaseUrl = `file:./${databaseName}`;
const digest = (seed: string) => seed.repeat(64).slice(0, 64);
const text = "A local id and equal text do not establish claim continuity.";
let prisma: PrismaClient;

describe("test-only second publication adapter materialization", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    execFileSync(
      process.execPath,
      [
        resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
        "db",
        "push",
        "--schema",
        "prisma/schema.prisma",
        "--skip-generate",
      ],
      {
        cwd: resolve(process.cwd(), "packages/db"),
        // RUST_LOG avoids a known Windows Prisma schema-engine startup race.
        env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" },
        stdio: "pipe",
      },
    );
    prisma = getPrisma();
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    for (const path of [databasePath, `${databasePath}-journal`, `${databasePath}-wal`]) {
      if (existsSync(path)) rmSync(path);
    }
  });

  it("keeps MyST V1 and synthetic-format V2 historical occurrences separate", async () => {
    // The synthetic type is intentionally absent from the production adapter
    // vocabulary, so this proof uses the raw portable schema without installing
    // production guards. The materializer itself must remain adapter-neutral.
    const publication = await prisma.publication.create({
      data: {
        stableKey: "publication:external:v1:portable-paper",
        publicationType: "research-article",
        recordSource: "external-publication",
        identityEvidenceJson: JSON.stringify({
          basis: "registration",
          registrationKey: "durable-portable-paper",
        }),
        sourceLocalPublicationId: "portable-paper",
      },
    });
    const v1 = await prisma.publicationVersion.create({
      data: {
        publicationId: publication.id,
        stableKey: "publication-version:v1:portable-paper-myst",
        sourceLocalPublicationId: "portable-paper",
        sourcesSha256: digest("1"),
        adapterType: "myst",
        adapterBindingJson: JSON.stringify({ type: "myst", protocolVersion: "0.2.0" }),
        structuralProvenance: "published-structure",
        observedPublicationBaseUrl: "https://host-a.example/paper/",
        observedAt: new Date("2026-08-24T00:00:00.000Z"),
      },
    });
    const v2 = await prisma.publicationVersion.create({
      data: {
        publicationId: publication.id,
        stableKey: "publication-version:v1:portable-paper-synthetic",
        sourceLocalPublicationId: "portable-paper",
        sourcesSha256: digest("2"),
        adapterType: "synthetic-format",
        adapterBindingJson: JSON.stringify({
          type: "synthetic-format",
          protocolVersion: "test-1",
        }),
        structuralProvenance: "published-structure",
        observedPublicationBaseUrl: "https://host-b.example/paper/",
        observedAt: new Date("2026-08-24T01:00:00.000Z"),
      },
    });
    const createOccurrence = (versionId: string, versionSeed: string, host: string) =>
      prisma.publicationClaimOccurrence.create({
        data: {
          publicationVersionId: versionId,
          sourceLocalClaimId: "result-1",
          stableKey: `publication-claim-occurrence:v1:${versionSeed}`,
          targetJson: JSON.stringify({
            type: versionSeed === "v1" ? "myst-xref" : "published-anchor",
            identifier: "result-1",
            ...(versionSeed === "v1" ? { htmlId: "result-1" } : { fragment: "result-1" }),
          }),
          publishedUrl: `https://${host}/paper/#result-1`,
          sourceBindingJson: JSON.stringify({
            documentPath: versionSeed === "v1" ? "article.md" : "article.test",
            documentSha256: digest(versionSeed === "v1" ? "a" : "b"),
            startLine: 1,
            endLine: 1,
            blockSha256: digest(versionSeed === "v1" ? "c" : "d"),
          }),
          selectorJson: JSON.stringify({
            representation:
              versionSeed === "v1" ? "oratlas-myst-source-utf8-v1" : "oratlas-source-utf8-v1",
            unit: "body",
            textQuote: { type: "TextQuoteSelector", exact: text },
            textPosition: { type: "TextPositionSelector", start: 0, end: text.length },
          }),
          declarationSha256: digest("e"),
          declarationAuthority: "publication-source",
          text,
        },
      });
    const occurrenceV1 = await createOccurrence(v1.id, "v1", "host-a.example");
    const occurrenceV2 = await createOccurrence(v2.id, "v2", "host-b.example");

    const materializedV2 = await prisma.$transaction((tx) =>
      materializePublicationClaimOccurrence(tx, occurrenceV2.id),
    );
    const afterV2 = await prisma.publicationClaimOccurrence.findMany({
      where: { id: { in: [occurrenceV1.id, occurrenceV2.id] } },
      orderBy: { id: "asc" },
    });
    expect(afterV2.find((row) => row.id === occurrenceV1.id)?.knowledgeNodeId).toBeNull();
    expect(afterV2.find((row) => row.id === occurrenceV2.id)?.knowledgeNodeId).toBe(
      materializedV2.knowledgeNodeId,
    );

    const materializedV1 = await prisma.$transaction((tx) =>
      materializePublicationClaimOccurrence(tx, occurrenceV1.id),
    );
    expect(materializedV1.knowledgeNodeId).not.toBe(materializedV2.knowledgeNodeId);
    expect(
      await prisma.publicationVersion.count({ where: { publicationId: publication.id } }),
    ).toBe(2);
    expect(
      await prisma.publicationClaimOccurrence.count({
        where: { publicationVersion: { publicationId: publication.id } },
      }),
    ).toBe(2);
  });
});
