import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { applyDatabaseGuards, type PrismaClient } from "@oratlas/db";
import type * as ProvenanceService from "./publication-provenance";
import type * as PacketService from "./publication-version-packet";

vi.mock("server-only", () => ({}));

const databaseName = `oratlas-production-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages/db/prisma", databaseName);
// Prisma resolves relative SQLite URLs from the directory containing schema.prisma.
const databaseUrl = `file:./${databaseName}`;
const digest = (seed: string) => seed.repeat(64).slice(0, 64);

let prisma: PrismaClient;
let provenance: typeof ProvenanceService;
let packets: typeof PacketService;
let editorId: string;

async function createPublication(name: string) {
  return prisma.publication.create({
    data: {
      stableKey: `publication:external:v1:${name}`,
      publicationType: "research-article",
      recordSource: "external-publication",
      identityEvidenceJson: JSON.stringify({ basis: "registration", registrationKey: name }),
      sourceLocalPublicationId: name,
    },
  });
}

async function createVersion(publicationId: string, name: string, sourceSeed: string) {
  return prisma.publicationVersion.create({
    data: {
      publicationId,
      stableKey: `publication-version:v1:${name}`,
      sourceLocalPublicationId: name,
      sourcesSha256: digest(sourceSeed),
      title: "An identical title is not continuity evidence",
      adapterType: "myst",
      adapterBindingJson: JSON.stringify({
        type: "myst",
        protocolVersion: "0.2.0",
        crossReferenceInventoryPath: "myst.xref.json",
        generatorName: "@oratlas/myst",
        generatorVersion: "0.2.0",
      }),
      structuralProvenance: "published-structure",
      observedPublicationBaseUrl: `https://${name}.example/article/`,
      observedAt: new Date("2026-08-24T00:00:00.000Z"),
    },
  });
}

describe("publication production provenance and transfer", () => {
  beforeAll(async () => {
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
    ({ prisma } = await import("./db"));
    await applyDatabaseGuards(prisma, "sqlite");
    provenance = await import("./publication-provenance");
    packets = await import("./publication-version-packet");
    editorId = (
      await prisma.user.create({
        data: {
          githubUserId: "production-editor",
          githubLogin: "production-editor",
          role: "EDITOR",
        },
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    for (const path of [databasePath, `${databasePath}-journal`, `${databasePath}-wal`]) {
      if (existsSync(path)) rmSync(path);
    }
  });

  it("keeps production optional and separates human from ARS on the same MyST path", async () => {
    const humanPublication = await createPublication("human-paper");
    const arsPublication = await createPublication("ars-paper");
    const humanVersion = await createVersion(humanPublication.id, "human-paper-v1", "1");
    const arsVersion = await createVersion(arsPublication.id, "ars-paper-v1", "2");

    expect(await provenance.listPublicationProductionProvenance(humanVersion.id)).toMatchObject({
      assertions: [],
      completeness: { returned: 0, total: 0, truncated: false },
    });
    expect(humanVersion.adapterType).toBe("myst");
    expect(arsVersion.adapterType).toBe("myst");

    const human = await provenance.createPublicationProductionAssertion(
      humanVersion.id,
      {
        mode: "human",
        actors: [{ kind: "person", name: "Declared human authors" }],
        activities: ["authoring", "editing"],
        statement: "The source declares human production with no AI production role.",
        strength: "source-declared",
      },
      editorId,
    );
    const ars = await provenance.createPublicationProductionAssertion(
      arsVersion.id,
      {
        mode: "agentic",
        actors: [
          {
            kind: "ai-system",
            name: "ARS",
            identifier: "https://agents.example/ars",
            provider: "Example Lab",
            model: "research-model",
          },
        ],
        activities: ["evidence-search", "evidence-synthesis", "drafting"],
        statement: "The source declares substantive production through an ARS workflow.",
        strength: "source-declared",
        publicEvidenceUrl: "https://agents.example/runs/public-ars-run",
      },
      editorId,
    );
    expect(human.mode).toBe("human");
    expect(ars.mode).toBe("agentic");
    expect(human.strength).toBe("source-declared");
    expect(ars.actors[0]?.kind).toBe("ai-system");
    expect(await prisma.person.count()).toBe(0);
  });

  it("distinguishes attestation, permits coexistence, and supersedes append-only", async () => {
    const arsVersion = await prisma.publicationVersion.findUniqueOrThrow({
      where: { stableKey: "publication-version:v1:ars-paper-v1" },
    });
    const agentRun = await prisma.agentRun.create({
      data: {
        agentType: "publication-production",
        modelProvider: "Example Lab",
        modelName: "research-model",
        modelVersion: "2026-08",
        status: "succeeded",
        completedAt: new Date("2026-08-24T00:30:00.000Z"),
      },
    });
    const attested = await provenance.createPublicationProductionAssertion(
      arsVersion.id,
      {
        mode: "agentic",
        actors: [{ kind: "ai-system", name: "ARS attested run" }],
        activities: ["evidence-synthesis"],
        strength: "oratlas-attested",
        agentRunId: agentRun.id,
      },
      editorId,
    );
    const before = await provenance.listPublicationProductionProvenance(arsVersion.id);
    expect(before.assertions).toHaveLength(2);
    expect(new Set(before.assertions.map((assertion) => assertion.strength))).toEqual(
      new Set(["source-declared", "oratlas-attested"]),
    );

    const correction = await provenance.createPublicationProductionAssertion(
      arsVersion.id,
      {
        mode: "hybrid",
        actors: [
          { kind: "person", name: "Human editors" },
          { kind: "ai-system", name: "ARS attested run" },
        ],
        activities: ["evidence-synthesis", "editing"],
        statement: "The attested run was followed by substantive human editing.",
        strength: "oratlas-attested",
        agentRunId: agentRun.id,
        supersedesAssertionId: attested.id,
      },
      editorId,
    );
    const after = await provenance.listPublicationProductionProvenance(arsVersion.id);
    expect(after.assertions).toHaveLength(3);
    expect(after.assertions.find((assertion) => assertion.id === attested.id)).toMatchObject({
      lifecycleState: "superseded",
      supersededByAssertionId: correction.id,
    });
    expect(correction).toMatchObject({
      lifecycleState: "active",
      supersedesAssertionId: attested.id,
    });
    await expect(
      prisma.publicationProductionAssertion.update({
        where: { id: attested.id },
        data: { mode: "human" },
      }),
    ).rejects.toThrow();
  });

  it("does not inherit provenance to a new version and includes public state in packet digests", async () => {
    const arsPublication = await prisma.publication.findUniqueOrThrow({
      where: { stableKey: "publication:external:v1:ars-paper" },
    });
    const v2 = await createVersion(arsPublication.id, "ars-paper-v2", "3");
    expect((await provenance.listPublicationProductionProvenance(v2.id)).assertions).toEqual([]);

    const v1 = await prisma.publicationVersion.findUniqueOrThrow({
      where: { stableKey: "publication-version:v1:ars-paper-v1" },
    });
    const firstPacket = await packets.getPublicationVersionPacket(v1.id);
    const replayedPacket = await packets.getPublicationVersionPacket(v1.id);
    expect(replayedPacket).toEqual(firstPacket);
    expect(firstPacket.productionProvenance).toHaveLength(3);
    expect(firstPacket.completeness.productionProvenance).toEqual({
      returned: 3,
      total: 3,
      truncated: false,
    });

    await provenance.createPublicationProductionAssertion(
      v1.id,
      {
        mode: "unspecified",
        actors: [],
        activities: [],
        statement: "The source supplies no further production-role declaration.",
        strength: "source-declared",
      },
      editorId,
    );
    const changedPacket = await packets.getPublicationVersionPacket(v1.id);
    expect(changedPacket.sha256).not.toBe(firstPacket.sha256);
    expect(changedPacket.productionProvenance).toHaveLength(4);
    expect(JSON.stringify(changedPacket)).not.toContain("promptHash");
    expect(JSON.stringify(changedPacket)).not.toContain("outputJson");
  });

  it("never infers continuity from identical metadata and records only an explicit review", async () => {
    const human = await prisma.publication.findUniqueOrThrow({
      where: { stableKey: "publication:external:v1:human-paper" },
    });
    const ars = await prisma.publication.findUniqueOrThrow({
      where: { stableKey: "publication:external:v1:ars-paper" },
    });
    expect((await provenance.listPublicationRelations(human.id)).relations).toEqual([]);
    const decision = {
      targetPublicationId: ars.id,
      relationType: "derived-from" as const,
      rationale:
        "An editor reviewed public transfer evidence; matching titles were explicitly ignored.",
      publicEvidenceUrl: "https://evidence.example/publication-transfer",
    };
    const created = await provenance.createPublicationRelation(human.id, decision, editorId);
    expect(created).toMatchObject({
      replayed: false,
      relation: {
        sourcePublicationId: human.id,
        targetPublicationId: ars.id,
        direction: "outgoing",
        relationType: "derived-from",
      },
    });
    const replayed = await provenance.createPublicationRelation(human.id, decision, editorId);
    expect(replayed).toMatchObject({
      replayed: true,
      relation: { id: created.relation.id },
    });
    await expect(
      provenance.createPublicationRelation(
        human.id,
        { ...decision, rationale: "A contradictory rationale for the same immutable relation." },
        editorId,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const otherEditor = await prisma.user.create({
      data: {
        githubUserId: "production-editor-2",
        githubLogin: "production-editor-2",
        role: "EDITOR",
      },
    });
    await expect(
      provenance.createPublicationRelation(human.id, decision, otherEditor.id),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(created.relation).toMatchObject({
      sourcePublicationId: human.id,
      targetPublicationId: ars.id,
      direction: "outgoing",
      relationType: "derived-from",
    });
    expect((await provenance.listPublicationRelations(ars.id)).relations[0]).toMatchObject({
      id: created.relation.id,
      direction: "incoming",
    });
    await expect(
      prisma.publicationRelation.update({
        where: { id: created.relation.id },
        data: { relationType: "mirror-of" },
      }),
    ).rejects.toThrow();
    expect(
      await prisma.auditEvent.count({
        where: { action: { in: ["publication-production.assert", "publication-relation.review"] } },
      }),
    ).toBeGreaterThanOrEqual(6);
  });
});
