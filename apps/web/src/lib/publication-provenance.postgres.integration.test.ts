import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { prisma } from "./db";
import {
  createPublicationProductionAssertion,
  createPublicationRelation,
} from "./publication-provenance";

const enabled = Boolean(process.env.PUBLICATION_PROVENANCE_TEST_DATABASE_URL);
const suffix = `${Date.now()}-${process.pid}`;
const digest = (seed: string) => seed.repeat(64).slice(0, 64);

async function createPublication(label: string) {
  return prisma.publication.create({
    data: {
      stableKey: `publication:provenance-race:${label}:${suffix}`,
      publicationType: "research-article",
      recordSource: "external-publication",
      identityEvidenceJson: JSON.stringify({
        basis: "registration",
        registrationKey: `${label}-${suffix}`,
      }),
    },
  });
}

describe.skipIf(!enabled)("publication provenance races on PostgreSQL", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("converges an exact relation race and rejects conflicting immutable replays", async () => {
    const editor = await prisma.user.create({
      data: { githubLogin: `provenance-editor-${suffix}`, role: "EDITOR" },
    });
    const otherEditor = await prisma.user.create({
      data: { githubLogin: `provenance-other-${suffix}`, role: "EDITOR" },
    });
    const source = await createPublication("source");
    const target = await createPublication("target");
    const decision = {
      targetPublicationId: target.id,
      relationType: "moved-to" as const,
      rationale: "An editor reviewed an exact public host-transfer declaration.",
      publicEvidenceUrl: "https://evidence.example/host-transfer",
    };
    const auditBefore = await prisma.auditEvent.count({
      where: { action: "publication-relation.review" },
    });

    const results = await Promise.all([
      createPublicationRelation(source.id, decision, editor.id),
      createPublicationRelation(source.id, decision, editor.id),
    ]);

    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(new Set(results.map((result) => result.relation.id)).size).toBe(1);
    expect(
      await prisma.publicationRelation.count({
        where: {
          sourcePublicationId: source.id,
          targetPublicationId: target.id,
          relationType: decision.relationType,
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({ where: { action: "publication-relation.review" } }),
    ).toBe(auditBefore + 1);
    await expect(
      createPublicationRelation(
        source.id,
        { ...decision, rationale: "A conflicting immutable transfer decision was submitted." },
        editor.id,
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      createPublicationRelation(source.id, decision, otherEditor.id),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("translates concurrent supersession into one creation and one typed conflict", async () => {
    const editor = await prisma.user.create({
      data: { githubLogin: `supersession-editor-${suffix}`, role: "EDITOR" },
    });
    const publication = await createPublication("supersession");
    const version = await prisma.publicationVersion.create({
      data: {
        publicationId: publication.id,
        stableKey: `publication-version:provenance-race:${suffix}`,
        sourcesSha256: digest("a"),
        adapterType: "myst",
        adapterBindingJson: JSON.stringify({ type: "myst", protocolVersion: "0.2.0" }),
        structuralProvenance: "published-structure",
        observedPublicationBaseUrl: "https://provenance.example/article/",
        observedAt: new Date("2026-08-24T00:00:00.000Z"),
      },
    });
    const prior = await createPublicationProductionAssertion(
      version.id,
      {
        mode: "agentic",
        actors: [{ kind: "workflow", name: "Original workflow" }],
        activities: ["authoring"],
        statement: "The source originally declared an agentic production workflow.",
        strength: "source-declared",
      },
      editor.id,
    );
    const correction = {
      mode: "hybrid" as const,
      actors: [{ kind: "workflow" as const, name: "Corrected workflow" }],
      activities: ["authoring" as const, "editing" as const],
      statement: "The corrected declaration includes substantive human editing.",
      strength: "source-declared" as const,
      supersedesAssertionId: prior.id,
    };
    const auditBefore = await prisma.auditEvent.count({
      where: { action: "publication-production.assert" },
    });

    const results = await Promise.allSettled([
      createPublicationProductionAssertion(version.id, correction, editor.id),
      createPublicationProductionAssertion(version.id, correction, editor.id),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected", reason: { code: "conflict" } });
    expect(
      await prisma.publicationProductionAssertion.count({
        where: { supersedesAssertionId: prior.id },
      }),
    ).toBe(1);
    expect(
      await prisma.auditEvent.count({ where: { action: "publication-production.assert" } }),
    ).toBe(auditBefore + 1);
  });
});
