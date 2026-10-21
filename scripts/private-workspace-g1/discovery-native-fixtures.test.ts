import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { publicationArtifactIdentitySha256 } from "../../packages/publications/src/adapter.js";
import {
  mystClaimRecordSchema,
  mystPublicationManifestSchema,
  normalizeMystPublication,
} from "../../packages/publications/src/adapters/myst.js";
import { DISCOVERY_TEXT } from "./discovery-scenarios.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const sql = fixture("discovery-fixtures.sql").toString("utf8");
const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");

// Read committed SQL, rather than regenerating expected database values from the manifest.
// These synthetic INSERTs use only quoted strings, booleans, NULL and integer literals.
function row(table: string, id: string): Record<string, string> {
  const statements = sql.matchAll(
    /INSERT INTO "([A-Za-z]+)" \(([\s\S]*?)\) VALUES \(([\s\S]*?)\);/gu,
  );
  for (const statement of statements) {
    if (statement[1] !== table) continue;
    const columns = [...statement[2]!.matchAll(/"([^"]+)"/gu)].map((m) => m[1]!);
    const values = [...statement[3]!.matchAll(/'(?:''|[^'])*'|NULL|true|false|\d+/gu)].map((m) =>
      m[0].startsWith("'") ? m[0].slice(1, -1).replaceAll("''", "'") : m[0],
    );
    expect(values.length).toBe(columns.length);
    const result = Object.fromEntries(columns.map((column, index) => [column, values[index]!]));
    if (result.id === id) return result;
  }
  throw new Error(`Missing synthetic fixture ${table}/${id}`);
}

const manifestBytes = fixture("discovery.manifest.json");
const manifest = mystPublicationManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
const claimsBytes = fixture("discovery.claims.jsonl");
const claims = claimsBytes
  .toString("utf8")
  .trim()
  .split("\n")
  .map((line) => mystClaimRecordSchema.parse(JSON.parse(line)));
const capture = row("PublicationCapture", "g1-discovery-manifest");
const manifestArtifact = {
  artifactKind: "publication-manifest" as const,
  requestedUrl: capture.requestedUrl!,
  observedUrl: capture.observedUrl!,
  mediaType: capture.mediaType!,
  bytes: manifestBytes,
  contentSha256: sha256(manifestBytes),
};
const input = {
  manifest,
  manifestArtifact,
  claims,
  publicationType: "research-article" as const,
  structuralProvenance: "published-structure" as const,
  observedAt: "2026-03-12T00:00:00.000Z",
  registrationKey: "g1-discovery-fixture",
};

describe("native MyST discovery fixture contract", () => {
  it("captures exact closed-schema 0.3 manifest bytes and normalizes its contributor declarations", () => {
    expect(manifest.schemaVersion).toBe("0.3.0");
    expect(capture.contentBytes).toBe(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(manifestBytes),
    );
    expect(Buffer.from(capture.contentBytes!, "utf8")).toEqual(manifestBytes);
    expect(Number(capture.byteLength)).toBe(manifestBytes.length);
    expect(capture.contentSha256).toBe(sha256(manifestBytes));
    expect(capture.declaredSha256).toBe(sha256(manifestBytes));
    expect(capture.artifactIdentitySha256).toBe(
      publicationArtifactIdentitySha256(manifestArtifact),
    );
    const normalized = normalizeMystPublication(input);
    const version = row("PublicationVersion", "g1-discovery-version");
    expect(normalized.version.adapter).toEqual(JSON.parse(version.adapterBindingJson!));
    expect(normalized.version.sourcesSha256).toBe(version.sourcesSha256);
    expect(version.contributorsDeclared).toBe("true");
    const contributor = row("PublicationVersionContributor", "g1-discovery-contributor");
    expect(normalized.contributors).toEqual([
      {
        sourceContributorKey: contributor.sourceContributorKey,
        kind: contributor.kind,
        displayName: contributor.displayName,
        identifiers: [],
        affiliations: [],
        roles: JSON.parse(contributor.rolesJson!),
        position: Number(contributor.position),
        sourceDeclarationProvenance: JSON.parse(contributor.sourceDeclarationProvenanceJson!),
      },
    ]);
    const production = row("PublicationProductionAssertion", "g1-discovery-production");
    expect(normalized.productionAssertions).toEqual([
      {
        sourceAssertionKey: production.sourceAssertionKey,
        mode: production.mode,
        actors: JSON.parse(production.actorsJson!),
        activities: JSON.parse(production.activitiesJson!),
        statement: production.statement,
        strength: production.strength,
      },
    ]);
  });

  it("binds the native claim stream, source capture and document corpus to the same bytes", () => {
    expect(manifest.artifacts.claims.sha256).toBe(sha256(claimsBytes));
    expect(manifest.artifacts.claims.records).toBe(claims.length);
    const source = row("PublicationCapture", "g1-discovery-source");
    const sourceBytes = Buffer.from(source.contentBytes!, "utf8");
    expect(sourceBytes.toString("utf8")).toBe(DISCOVERY_TEXT);
    expect(source.contentSha256).toBe(sha256(sourceBytes));
    expect(source.declaredSha256).toBe(sha256(sourceBytes));
    expect(Number(source.byteLength)).toBe(sourceBytes.length);
    expect(source.artifactIdentitySha256).toBe(
      publicationArtifactIdentitySha256({
        artifactKind: "source-document",
        declaredPath: "article.md",
      }),
    );
    // This is an explicit synthetic source-set digest, not evidence of a producer execution.
    expect(manifest.publication.version.sourcesSha256).toBe(
      sha256(canonicalJson([{ path: "article.md", sha256: sha256(sourceBytes) }])),
    );
    const version = row("PublicationVersion", "g1-discovery-version");
    const corpus = JSON.parse(version.contentCorpusJson!);
    expect(version.contentCorpusSha256).toBe(sha256(canonicalJson(corpus)));
    expect(corpus[0]).toMatchObject({
      text: DISCOVERY_TEXT,
      sha256: source.contentSha256,
      sourceArtifactIdentitySha256: source.artifactIdentitySha256,
      sourceArtifactSha256: source.contentSha256,
    });
    const occurrence = row("PublicationClaimOccurrence", "g1-discovery-occurrence");
    const claim = claims[0]!;
    expect(claim.declarationSha256).toBe(
      sha256(
        canonicalJson({
          schemaVersion: "0.2.0",
          id: claim.id,
          body: DISCOVERY_TEXT,
          claimType: "empirical",
        }),
      ),
    );
    expect(normalizeMystPublication(input).occurrences[0]).toMatchObject({
      sourceLocalClaimId: occurrence.sourceLocalClaimId,
      target: JSON.parse(occurrence.targetJson!),
      sourceBinding: JSON.parse(occurrence.sourceBindingJson!),
      selector: JSON.parse(occurrence.selectorJson!),
      declarationSha256: occurrence.declarationSha256,
      declaration: {
        authority: "publication-source",
        text: occurrence.text,
        claimType: occurrence.claimType,
      },
    });
  });

  it("rejects unsupported 0.2 contributor and production declarations without relaxing the normalizer", () => {
    const unsupported = { ...manifest, schemaVersion: "0.2.0" };
    expect(mystPublicationManifestSchema.safeParse(unsupported).success).toBe(false);
    expect(() => normalizeMystPublication({ ...input, manifest: unsupported })).toThrow();
    const {
      contributors: _contributors,
      production: _production,
      ...legacy
    } = JSON.parse(manifestBytes.toString("utf8"));
    const supportedLegacy = { ...legacy, schemaVersion: "0.2.0" };
    // Each unsupported declaration independently fails the frozen 0.2 schema.
    for (const declaration of [{ contributors: _contributors }, { production: _production }]) {
      const invalidLegacy = { ...supportedLegacy, ...declaration };
      expect(mystPublicationManifestSchema.safeParse(invalidLegacy).success).toBe(false);
      expect(() => normalizeMystPublication({ ...input, manifest: invalidLegacy })).toThrow();
    }
    expect(mystPublicationManifestSchema.safeParse(supportedLegacy).success).toBe(true);
    const normalized = normalizeMystPublication({ ...input, manifest: supportedLegacy });
    expect(normalized.contributors).toBeUndefined();
    expect(normalized.productionAssertions).toBeUndefined();
    expect(() => normalizeMystPublication({ ...input, manifestArtifact: undefined })).toThrow(
      /exact captured publication manifest/u,
    );
  });
});
