import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicationArtifactIdentitySha256 } from "../adapter.js";
import {
  mystPublicationManifestSchema,
  normalizeMystPublication,
  type MystPublicationManifest,
} from "./myst.js";

const FIXTURE_ROOT = new URL("./fixtures/myst-0.3.0/", import.meta.url);
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

function fixture(name: string): { manifest: MystPublicationManifest; bytes: Buffer } {
  const bytes = readFileSync(new URL(name, FIXTURE_ROOT));
  return {
    manifest: mystPublicationManifestSchema.parse(JSON.parse(bytes.toString("utf8"))),
    bytes,
  };
}

function normalize(name: string) {
  const { manifest, bytes } = fixture(name);
  const manifestArtifact = {
    artifactKind: "publication-manifest" as const,
    requestedUrl: `https://fixtures.example/${name}`,
    observedUrl: `https://fixtures.example/${name}`,
    mediaType: "application/json",
    bytes,
    contentSha256: sha256(bytes),
  };
  return {
    manifestArtifact,
    normalized: normalizeMystPublication({
      manifest,
      manifestArtifact,
      claims: [],
      publicationType: "research-article",
      structuralProvenance: "published-structure",
      observedAt: "2026-08-25T00:00:00.000Z",
      registrationKey: "upstream-0.3-fixture",
    }),
  };
}

interface MutableFixtureManifest {
  schemaVersion: string;
  contributors: Array<{
    sourceContributorKey: string;
    kind: string;
    position: number;
    identifiers?: Array<{ scheme: string; value: string }>;
    [key: string]: unknown;
  }>;
  production: {
    mode: string;
    actors: Array<{ id: string; activities: string[]; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const malformedCases: Array<readonly [string, (manifest: MutableFixtureManifest) => void]> = [
  [
    "duplicate contributor keys",
    (manifest) => {
      manifest.contributors = [
        manifest.contributors[0]!,
        { ...manifest.contributors[0]!, position: 2 },
      ];
    },
  ],
  [
    "non-contiguous contributor position",
    (manifest) => {
      manifest.contributors[0]!.position = 2;
    },
  ],
  [
    "invalid contributor kind",
    (manifest) => {
      manifest.contributors[0]!.kind = "ai-system";
    },
  ],
  [
    "invalid ORCID",
    (manifest) => {
      manifest.contributors[0]!.identifiers = [{ scheme: "orcid", value: "0000-0002-1825-0098" }];
    },
  ],
  [
    "duplicate production actor ids",
    (manifest) => {
      manifest.production.actors[1]!.id = manifest.production.actors[0]!.id;
    },
  ],
  [
    "malformed production mode",
    (manifest) => {
      manifest.production.mode = "mostly-ai";
    },
  ],
  [
    "malformed actor activities",
    (manifest) => {
      manifest.production.actors[0]!.activities = ["web-browsing"];
    },
  ],
  [
    "unknown manifest fields",
    (manifest) => {
      manifest.quality = "excellent";
    },
  ],
  [
    "unsupported future version",
    (manifest) => {
      manifest.schemaVersion = "0.4.0";
    },
  ],
];

describe("MyST manifest protocol 0.3.0 pinned compatibility", () => {
  it("accepts the five exact upstream examples and rejects the upstream malformed examples", () => {
    for (const name of [
      "human.manifest.json",
      "ai-assisted.manifest.json",
      "ars-hybrid.manifest.json",
      "agentic-no-contributors.manifest.json",
      "group-author.manifest.json",
    ]) {
      expect(
        mystPublicationManifestSchema.safeParse(JSON.parse(fixture(name).bytes.toString())).success,
        name,
      ).toBe(true);
    }
    for (const name of [
      "malformed/duplicate-actor.manifest.json",
      "malformed/software-contributor.manifest.json",
    ]) {
      const bytes = readFileSync(new URL(name, FIXTURE_ROOT));
      expect(
        mystPublicationManifestSchema.safeParse(JSON.parse(bytes.toString())).success,
        name,
      ).toBe(false);
    }
  });

  it("preserves human contributor order and binds every snapshot to the exact manifest capture", () => {
    const { normalized, manifestArtifact } = normalize("human.manifest.json");
    expect(normalized.version.adapter.protocolVersion).toBe("0.3.0");
    expect(normalized.contributors?.map((contributor) => contributor.sourceContributorKey)).toEqual(
      ["alice", "bob"],
    );
    expect(normalized.contributors?.[0]).toMatchObject({
      kind: "person",
      displayName: "Alice Smith",
      givenName: "Alice",
      familyName: "Smith",
      roles: ["author", "corresponding-author"],
      position: 1,
      sourceDeclarationProvenance: {
        type: "source-declared",
        sourceArtifactKind: "publication-manifest",
        sourceArtifactIdentitySha256: publicationArtifactIdentitySha256(manifestArtifact),
        sourceArtifactSha256: manifestArtifact.contentSha256,
      },
    });
    expect(normalized.productionAssertions).toBeUndefined();
  });

  it("keeps contributors and production actors independent and strips source actor ids and activities", () => {
    const { normalized } = normalize("ai-assisted.manifest.json");
    expect(normalized.contributors).toHaveLength(1);
    expect(normalized.contributors?.[0]?.displayName).toBe("Alice Smith");
    expect(normalized.productionAssertions?.[0]).toMatchObject({
      sourceAssertionKey: "publication-production",
      strength: "source-declared",
      mode: "ai-assisted",
      activities: ["drafting", "editing", "reviewing"],
      actors: [
        {
          kind: "ai-system",
          name: "Example Assistant",
          provider: "Example Provider",
          model: "example-model",
          modelVersion: "2026-08",
        },
        { kind: "person", name: "Alice Smith" },
      ],
    });
    for (const actor of normalized.productionAssertions?.[0]?.actors ?? []) {
      expect(actor).not.toHaveProperty("id");
      expect(actor).not.toHaveProperty("activities");
    }
    expect(
      normalized.contributors?.some(
        (contributor) => contributor.displayName === "Example Assistant",
      ),
    ).toBe(false);
  });

  it("derives the first-seen ordered activity union for ARS without making ARS a contributor", () => {
    const { normalized } = normalize("ars-hybrid.manifest.json");
    expect(normalized.productionAssertions?.[0]?.activities).toEqual([
      "evidence-search",
      "evidence-synthesis",
      "drafting",
      "authoring",
      "editing",
      "reviewing",
    ]);
    expect(normalized.contributors?.map((contributor) => contributor.displayName)).toEqual([
      "Lead Researcher",
    ]);
  });

  it("accepts production without contributors and an organization contributor without Person identity", () => {
    const agentic = normalize("agentic-no-contributors.manifest.json").normalized;
    expect(agentic.contributors).toBeUndefined();
    expect(agentic.productionAssertions?.[0]?.mode).toBe("agentic");

    const group = normalize("group-author.manifest.json").normalized;
    expect(group.contributors?.[0]).toMatchObject({
      kind: "organization",
      displayName: "Example Research Consortium",
      identifiers: [{ scheme: "ror", value: "https://ror.org/03yrm5c26" }],
      roles: ["group-author"],
    });
    expect(group.contributors?.[0]).not.toHaveProperty("givenName");
    expect(group.contributors?.[0]).not.toHaveProperty("familyName");
    expect(group.contributors?.[0]).not.toHaveProperty("personId");
  });

  it("accepts frozen 0.2.0 claim records under a 0.3.0 manifest", () => {
    const { manifest, bytes } = fixture("human.manifest.json");
    const claim = {
      schemaVersion: "0.2.0",
      id: "claim-1",
      text: "A frozen claim record remains valid.",
      target: { type: "myst-xref", identifier: "claim-1", htmlId: "claim-1" },
      source: {
        documentPath: "results.md",
        documentSha256: "1".repeat(64),
        startLine: 1,
        endLine: 1,
        blockSha256: "2".repeat(64),
      },
      selector: {
        representation: "oratlas-myst-source-utf8-v1",
        unit: "body",
        textQuote: { type: "TextQuoteSelector", exact: "A frozen claim record remains valid." },
        textPosition: { type: "TextPositionSelector", start: 0, end: 36 },
      },
      declarationSha256: "3".repeat(64),
    };
    const manifestArtifact = {
      artifactKind: "publication-manifest" as const,
      requestedUrl: "https://fixtures.example/claims/oratlas.manifest.json",
      mediaType: "application/json",
      bytes,
      contentSha256: sha256(bytes),
    };
    const normalized = normalizeMystPublication({
      manifest: {
        ...manifest,
        artifacts: { claims: { ...manifest.artifacts.claims, records: 1 } },
      },
      manifestArtifact,
      claims: [claim],
      publicationType: "research-article",
      structuralProvenance: "published-structure",
      observedAt: "2026-08-25T00:00:00.000Z",
      registrationKey: "0.3-manifest-0.2-claim",
    });
    expect(normalized.occurrences).toHaveLength(1);
    expect(normalized.version.adapter.protocolVersion).toBe("0.3.0");
  });

  it.each(malformedCases)("fails closed on %s", (_label, mutate) => {
    const sourceName =
      _label.includes("production") || _label.includes("actor")
        ? "ai-assisted.manifest.json"
        : "human.manifest.json";
    const value = JSON.parse(fixture(sourceName).bytes.toString("utf8")) as MutableFixtureManifest;
    mutate(value);
    expect(mystPublicationManifestSchema.safeParse(value).success).toBe(false);
  });

  it("keeps exact-version canonical identity neutral to declared production mode", () => {
    const { manifest, bytes } = fixture("ai-assisted.manifest.json");
    if (manifest.schemaVersion !== "0.3.0" || manifest.production === undefined) {
      throw new Error("Expected the frozen AI-assisted 0.3 fixture.");
    }
    const manifestArtifact = {
      artifactKind: "publication-manifest" as const,
      requestedUrl: "https://fixtures.example/mode/oratlas.manifest.json",
      mediaType: "application/json",
      bytes,
      contentSha256: sha256(bytes),
    };
    const normalizeMode = (mode: "human" | "ai-assisted" | "agentic" | "hybrid") =>
      normalizeMystPublication({
        manifest: { ...manifest, production: { ...manifest.production, mode } },
        manifestArtifact,
        claims: [],
        publicationType: "research-article",
        structuralProvenance: "published-structure",
        observedAt: "2026-08-25T00:00:00.000Z",
        registrationKey: "mode-neutral-publication",
      });
    const identities = ["human", "ai-assisted", "agentic", "hybrid"].map((mode) => {
      const value = normalizeMode(mode as "human" | "ai-assisted" | "agentic" | "hybrid");
      return [value.publication.stableKey, value.version.stableKey];
    });
    expect(new Set(identities.map((identity) => JSON.stringify(identity))).size).toBe(1);
  });
});
