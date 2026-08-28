import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  FIXTURE_URL_SAFETY_POLICY,
  startFixtureSite,
  type FixtureSite,
} from "@oratlas/safe-fetch/testing";
import { assessExternalUrl } from "@oratlas/safe-fetch";
import {
  buildPublicationFixture,
  FIXTURE_DOCUMENT_PATH,
  type PublicationFixture,
} from "@oratlas/publications/testing";
import { type PublicationSourceDocumentResolver } from "@oratlas/publications";
import { type PrismaClient } from "@oratlas/db";
import { type registerExternalPublication } from "./publication-registration";
import {
  type getPublicationRegistrationCaptureResource,
  type getPublicationResource,
  type getPublicationVersionResource,
} from "./publication-queries";

vi.mock("server-only", () => ({}));

/**
 * Registration end to end: a real local HTTP fixture, the real outbound
 * boundary, the real pipeline, and a real database with its guards applied.
 *
 * Required CI never touches the public internet. The fixture binds to
 * loopback, and the only reason it is reachable at all is the explicit,
 * non-production-only opt-in this test sets before anything is imported.
 */

// Vitest already runs with NODE_ENV=test; the opt-in below is refused outright
// in production, so a fixture policy can never become the deployed one.
process.env.PUBLICATION_REGISTRATION_ALLOW_INSECURE_FETCH = "1";
process.env.NEXT_PUBLIC_BASE_URL = "https://atlas.test";

const inheritedDatabaseUrl = process.env.DATABASE_URL;
const usesExternalPostgres = /^(?:postgresql|postgres):\/\//.test(inheritedDatabaseUrl ?? "");
const databasePath = usesExternalPostgres
  ? undefined
  : `/tmp/oratlas-publication-registration-${process.pid}-${Date.now()}.db`;
const databaseUrl = usesExternalPostgres ? inheritedDatabaseUrl! : `file:${databasePath}`;

interface Runtime {
  prisma: PrismaClient;
  registerExternalPublication: typeof registerExternalPublication;
  getPublicationResource: typeof getPublicationResource;
  getPublicationVersionResource: typeof getPublicationVersionResource;
  getPublicationRegistrationCaptureResource: typeof getPublicationRegistrationCaptureResource;
}

let runtime: Runtime;
let site: FixtureSite;
let editorId: string;

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  ".json": "application/json",
  ".jsonl": "application/jsonl",
};

function publish(files: Record<string, string>): void {
  for (const [path, body] of Object.entries(files)) {
    const extension = path.slice(path.lastIndexOf("."));
    site.routes.set(path, {
      body,
      headers: { "content-type": MEDIA_TYPE_BY_EXTENSION[extension] ?? "application/json" },
    });
  }
}

function sourceResolver(documents: Record<string, string>): PublicationSourceDocumentResolver {
  return {
    name: "fixture-source",
    supports: () => ({ supported: true }) as const,
    readDocument: async (_source, documentPath) => {
      const text = documents[documentPath];
      if (text === undefined) return { ok: false, reason: "source-document-unavailable" as const };
      return { ok: true as const, text };
    },
  };
}

const GIT_SOURCE = {
  type: "git",
  repository: "https://github.com/lab/adolescent-stress",
  commit: "a".repeat(40),
};

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  if (!usesExternalPostgres) {
    execFileSync(
      process.execPath,
      [
        resolve(process.cwd(), "packages/db/node_modules/prisma/build/index.js"),
        "db",
        "push",
        "--schema",
        "packages/db/prisma/schema.prisma",
        "--skip-generate",
      ],
      { env: { ...process.env, DATABASE_URL: databaseUrl, RUST_LOG: "info" }, stdio: "pipe" },
    );
  }
  const { prisma } = await import("./db");
  const { applyDatabaseGuards } = await import("@oratlas/db");
  await applyDatabaseGuards(prisma, usesExternalPostgres ? "postgresql" : "sqlite");

  const registration = await import("./publication-registration");
  const queries = await import("./publication-queries");
  runtime = {
    prisma,
    registerExternalPublication: registration.registerExternalPublication,
    getPublicationResource: queries.getPublicationResource,
    getPublicationVersionResource: queries.getPublicationVersionResource,
    getPublicationRegistrationCaptureResource: queries.getPublicationRegistrationCaptureResource,
  };

  const editor = await prisma.user.create({
    data: { githubUserId: "publication-editor", githubLogin: "publication-editor", role: "EDITOR" },
  });
  editorId = editor.id;

  site = await startFixtureSite();
}, 60_000);

afterAll(async () => {
  await site?.close();
  await runtime?.prisma.$disconnect();
  if (!databasePath) return;
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe.sequential("external publication registration", () => {
  it("registers a web-only publication and records published-structure provenance", async () => {
    const fixture: PublicationFixture = buildPublicationFixture({
      deployPath: "/web-only",
      canonicalUrl: "https://example.org/web-only/",
      publicationId: "web-only-review",
    });
    publish(fixture.files);

    const result = await runtime.registerExternalPublication(
      {
        manifestUrl: site.url(fixture.manifestPath),
        publicationType: "research-article",
        actorId: editorId,
      },
      { sourceResolver: null },
    );

    expect(result.disposition).toBe("captured");
    expect(result.manifestSchemaVersion).toBe("0.2.0");
    expect(result.adapterType).toBe("myst");
    expect(result.claimOccurrenceCount).toBe(2);
    expect(result.structuralProvenance).toBe("published-structure");
    expect(result.sourceVerification).toEqual({
      outcome: "unavailable",
      reason: "no-source-declared",
    });
    expect(result.links.publication).toBe(
      `https://atlas.test/api/publications/${result.publication.id}`,
    );
    expect(result.links.publicationVersion).toContain(result.publicationVersion.id);
    expect(result.links.capture).toContain(result.capture.id);

    // The exact bytes are retained, with digests ORAtlas recomputed.
    const captures = await runtime.prisma.publicationCapture.findMany({
      where: { publicationVersionId: result.publicationVersion.id },
      orderBy: { artifactKind: "asc" },
    });
    expect(captures.map((capture) => capture.artifactKind)).toEqual([
      "claim-stream",
      "cross-reference-inventory",
      "publication-manifest",
    ]);
    const claimStream = captures.find((capture) => capture.artifactKind === "claim-stream")!;
    expect(claimStream.contentBytes).toBe(fixture.claimsJsonl);
    expect(claimStream.declaredSha256).toBe(claimStream.contentSha256);
    expect(JSON.parse(claimStream.httpProvenanceJson!)).toMatchObject({ status: 200 });
    expect(captures.every((capture) => capture.registrationCaptureId === result.capture.id)).toBe(
      true,
    );
  });

  it("materializes source occurrences without binding any canonical claim", async () => {
    const publication = await runtime.getPublicationResource(
      (await runtime.prisma.publication.findFirstOrThrow({ orderBy: { createdAt: "asc" } })).id,
    );
    const version = await runtime.getPublicationVersionResource(
      publication!.id,
      publication!.versions[0]!.id,
    );

    expect(version!.claimOccurrences).toHaveLength(2);
    for (const occurrence of version!.claimOccurrences) {
      expect(occurrence.canonicalKnowledgeNodeId).toBeNull();
      expect(occurrence.targetIdentifier).toBe(occurrence.sourceLocalClaimId);
      expect(occurrence.declarationAuthority).toBe("publication-source");
    }
    // Structural provenance is never described as a scientific state.
    expect(version!.structuralProvenanceDescription).not.toMatch(
      /verified|trustworthy|confirmed|peer[- ]reviewed/i,
    );
  });

  it("replays an identical observation instead of capturing it twice", async () => {
    const fixture = buildPublicationFixture({
      deployPath: "/replay",
      canonicalUrl: "https://example.org/replay/",
      publicationId: "replay-review",
    });
    publish(fixture.files);
    const input = {
      manifestUrl: site.url(fixture.manifestPath),
      publicationType: "research-article" as const,
      actorId: editorId,
    };

    const first = await runtime.registerExternalPublication(input, { sourceResolver: null });
    const second = await runtime.registerExternalPublication(input, { sourceResolver: null });

    expect(second.disposition).toBe("replayed");
    expect(second.capture.id).toBe(first.capture.id);
    expect(second.capture.captureKey).toBe(first.capture.captureKey);
    expect(second.publicationVersion.id).toBe(first.publicationVersion.id);
    expect(
      await runtime.prisma.publicationRegistrationCapture.count({
        where: { registration: { manifestUrl: input.manifestUrl } },
      }),
    ).toBe(1);
  });

  it("keeps the earlier capture when the same URL is republished", async () => {
    const first = buildPublicationFixture({
      deployPath: "/moving",
      canonicalUrl: "https://example.org/moving/",
      publicationId: "moving-review",
      source: GIT_SOURCE,
    });
    publish(first.files);
    const input = {
      manifestUrl: site.url(first.manifestPath),
      publicationType: "research-article" as const,
      actorId: editorId,
    };
    const before = await runtime.registerExternalPublication(input, { sourceResolver: null });

    const republished = buildPublicationFixture({
      deployPath: "/moving",
      canonicalUrl: "https://example.org/moving/",
      publicationId: "moving-review",
      source: GIT_SOURCE,
      claims: [
        {
          id: "hpa-axis-mediation",
          body: "A revised statement of the mediation claim, published later.",
          claimType: "mechanistic",
        },
      ],
    });
    publish(republished.files);
    const after = await runtime.registerExternalPublication(input, { sourceResolver: null });

    expect(after.disposition).toBe("new-version-captured");
    expect(after.capture.id).not.toBe(before.capture.id);
    expect(after.publicationVersion.id).not.toBe(before.publicationVersion.id);
    // One publication, two versions: identity survives republication.
    expect(after.publication.id).toBe(before.publication.id);

    const captures = await runtime.prisma.publicationRegistrationCapture.findMany({
      where: { registration: { manifestUrl: input.manifestUrl } },
      orderBy: { createdAt: "asc" },
    });
    expect(captures).toHaveLength(2);
    expect(captures[0]!.id).toBe(before.capture.id);
    expect(captures[0]!.manifestSha256).not.toBe(captures[1]!.manifestSha256);
  });

  it("refuses to rewrite a capture once it is bound", async () => {
    const capture = await runtime.prisma.publicationRegistrationCapture.findFirstOrThrow();
    await expect(
      runtime.prisma.publicationRegistrationCapture.update({
        where: { id: capture.id },
        data: { manifestSha256: "b".repeat(64) },
      }),
    ).rejects.toThrow();
    await expect(
      runtime.prisma.publicationRegistrationCapture.delete({ where: { id: capture.id } }),
    ).rejects.toThrow();
  });

  it("reaches source-byte only when the exact source bytes verify", async () => {
    const fixture = buildPublicationFixture({
      deployPath: "/source-backed",
      canonicalUrl: "https://example.org/source-backed/",
      publicationId: "source-backed-review",
      source: GIT_SOURCE,
    });
    publish(fixture.files);

    const result = await runtime.registerExternalPublication(
      {
        manifestUrl: site.url(fixture.manifestPath),
        publicationType: "research-article",
        actorId: editorId,
      },
      { sourceResolver: sourceResolver(fixture.sourceDocuments) },
    );

    expect(result.structuralProvenance).toBe("source-byte");
    expect(result.sourceVerification).toEqual({
      outcome: "reached",
      sourceType: "git",
      resolver: "fixture-source",
      documentsChecked: 1,
    });
    const stored = await runtime.prisma.publicationVersion.findUniqueOrThrow({
      where: { id: result.publicationVersion.id },
    });
    expect(stored.structuralProvenance).toBe("source-byte");
    expect(stored.sourceDescriptorJson).not.toBeNull();
  });

  it("does not let an unavailable source masquerade as source-byte", async () => {
    const fixture = buildPublicationFixture({
      deployPath: "/source-missing",
      canonicalUrl: "https://example.org/source-missing/",
      publicationId: "source-missing-review",
      source: GIT_SOURCE,
    });
    publish(fixture.files);

    const result = await runtime.registerExternalPublication(
      {
        manifestUrl: site.url(fixture.manifestPath),
        publicationType: "research-article",
        actorId: editorId,
      },
      { sourceResolver: sourceResolver({}) },
    );

    expect(result.structuralProvenance).toBe("published-structure");
    expect(result.sourceVerification).toEqual({
      outcome: "unavailable",
      reason: "source-document-unavailable",
      sourceType: "git",
    });
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "source-byte-verification-not-reached",
    );

    // The reason is retained on the capture, not merely returned once.
    const capture = await runtime.prisma.publicationRegistrationCapture.findUniqueOrThrow({
      where: { id: result.capture.id },
    });
    expect(JSON.parse(capture.sourceVerificationJson)).toEqual({
      outcome: "unavailable",
      reason: "source-document-unavailable",
      sourceType: "git",
    });
  });

  it("refuses a publication whose source bytes disagree, and writes nothing", async () => {
    const fixture = buildPublicationFixture({
      deployPath: "/tampered",
      canonicalUrl: "https://example.org/tampered/",
      publicationId: "tampered-review",
      source: GIT_SOURCE,
    });
    publish(fixture.files);
    const before = await runtime.prisma.publicationVersion.count();

    await expect(
      runtime.registerExternalPublication(
        {
          manifestUrl: site.url(fixture.manifestPath),
          publicationType: "research-article",
          actorId: editorId,
        },
        {
          sourceResolver: sourceResolver({
            [FIXTURE_DOCUMENT_PATH]: `${fixture.sourceDocuments[FIXTURE_DOCUMENT_PATH]!}\nedited\n`,
          }),
        },
      ),
    ).rejects.toMatchObject({ reason: "source-verification-mismatch", code: "upstream-error" });

    expect(await runtime.prisma.publicationVersion.count()).toBe(before);
    expect(
      await runtime.prisma.publicationRegistration.count({
        where: { manifestUrl: site.url(fixture.manifestPath) },
      }),
    ).toBe(0);
  });

  it("refuses a manifest URL the outbound policy will not accept", async () => {
    await expect(
      runtime.registerExternalPublication(
        {
          manifestUrl: "http://169.254.169.254/oratlas.manifest.json",
          actorId: editorId,
        },
        { sourceResolver: null },
      ),
    ).rejects.toMatchObject({ reason: "manifest-url-rejected", code: "bad-request" });
  });

  it("never returns an internal network detail in a refusal", async () => {
    publish({ "/broken/oratlas.manifest.json": "{ not json" });
    await expect(
      runtime.registerExternalPublication(
        { manifestUrl: site.url("/broken/oratlas.manifest.json"), actorId: editorId },
        { sourceResolver: null },
      ),
    ).rejects.toMatchObject({ reason: "manifest-invalid-json" });
  });

  it("serves an audit view of the capture without re-serving the retained bytes", async () => {
    const capture = await runtime.prisma.publicationRegistrationCapture.findFirstOrThrow({
      orderBy: { createdAt: "asc" },
    });
    const resource = await runtime.getPublicationRegistrationCaptureResource(capture.id);

    expect(resource!.captureKey).toMatch(/^[0-9a-f]{64}$/);
    expect(resource!.manifestProvenance.status).toBe(200);
    expect(resource!.artifacts.length).toBeGreaterThan(0);
    expect(JSON.stringify(resource)).not.toContain('schemaVersion\\":\\"0.2.0');
    expect(resource!.links.publicationVersion).toBeDefined();
  });

  it("holds the production policy: the fixture is only reachable by explicit opt-in", () => {
    // With no relaxation, this exact URL is refused before any request is made.
    expect(assessExternalUrl(site.url("/web-only/oratlas.manifest.json")).ok).toBe(false);
    expect(
      assessExternalUrl(site.url("/web-only/oratlas.manifest.json"), FIXTURE_URL_SAFETY_POLICY).ok,
    ).toBe(true);
  });
});
