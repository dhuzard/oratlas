import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { MYST_PUBLICATION_PROTOCOL_VERSION } from "@oratlas/contracts";
import { mystClaimRecordSchema, mystPublicationManifestSchema } from "../adapters/myst.js";
import { buildPublicationFixture } from "../testing/index.js";

/**
 * Schema drift detection for the pinned producer contract.
 *
 * ORAtlas is a **consumer** of `dhuzard/oratlas-myst` schema `0.2.0`. It does not depend on
 * that package at runtime: coupling every independently hosted publication to ORAtlas's
 * release cadence would be the wrong boundary, and a MyST adapter is not something ORAtlas's
 * ingestion contract should have to import. So ORAtlas re-expresses the protocol as Zod
 * schemas it owns — and that re-expression is exactly the thing that can silently drift.
 *
 * The boundary is therefore made explicit and checked here, offline:
 *
 * 1. The upstream JSON Schemas are captured byte-for-byte under `pinned/`, and their digests
 *    are asserted, so an accidental edit or a careless re-pin fails immediately.
 * 2. Every document in the corpus below is validated against both the pinned upstream schema
 *    and ORAtlas's Zod schema, and the two must **agree**. A field the producer adds, removes
 *    or loosens shows up as a disagreement rather than as a subtly wrong ingestion.
 * 3. The version constant ORAtlas pins is checked against the version the schema declares.
 *
 * Re-pinning is a deliberate, reviewed re-capture; see `CROSS_REPO_DEPENDENCIES.md`.
 */

const PINNED = resolve(import.meta.dirname, "pinned");

/** Digests of the captured upstream schemas at the recorded pin. */
const PINNED_DIGESTS = {
  "oratlas-manifest.schema.json":
    "b2cd91147b6631bc8883089600de3829c7faef24b00e30cba77ce0a39e405f2a",
  "oratlas-claim.schema.json": "ff7ddd2d0001c51c3b93b2f2c55868621bd7580470b3cc67f2ee7ab864a13a51",
} as const;

function readPinned(name: keyof typeof PINNED_DIGESTS): { text: string; schema: object } {
  const text = readFileSync(resolve(PINNED, name), "utf8");
  return { text, schema: JSON.parse(text) as object };
}

const ajv = addFormats(new Ajv({ strict: false, allErrors: true }));
const manifestPinned = readPinned("oratlas-manifest.schema.json");
const claimPinned = readPinned("oratlas-claim.schema.json");
const validateManifest: ValidateFunction = ajv.compile(manifestPinned.schema);
const validateClaim: ValidateFunction = ajv.compile(claimPinned.schema);

const fixture = buildPublicationFixture();
const sourceBacked = buildPublicationFixture({
  source: { type: "git", repository: "https://github.com/lab/review", commit: "a".repeat(40) },
});
const delegated = buildPublicationFixture({
  declarations: "review-manifest",
  reviewManifestPath: "review-manifest.json",
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("pinned upstream protocol schemas", () => {
  it.each(Object.entries(PINNED_DIGESTS))("captures %s byte-for-byte", (name, digest) => {
    const text = readFileSync(resolve(PINNED, name), "utf8");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toBe(digest);
  });

  it("pins the schema version ORAtlas implements", () => {
    const manifestSchema = manifestPinned.schema as {
      properties: { schemaVersion: { const?: string } };
    };
    expect(manifestSchema.properties.schemaVersion.const).toBe(MYST_PUBLICATION_PROTOCOL_VERSION);
    const claimSchema = claimPinned.schema as {
      properties: { schemaVersion: { const?: string } };
    };
    expect(claimSchema.properties.schemaVersion.const).toBe(MYST_PUBLICATION_PROTOCOL_VERSION);
  });
});

describe("ORAtlas's reader agrees with the pinned producer contract", () => {
  const manifests: Array<[string, unknown]> = [
    ["web-only publication", fixture.manifest],
    ["source-backed publication", sourceBacked.manifest],
    ["publication delegating declarations to a review manifest", delegated.manifest],
  ];

  it.each(manifests)("accepts a valid manifest: %s", (_label, manifest) => {
    expect(validateManifest(clone(manifest)), JSON.stringify(validateManifest.errors)).toBe(true);
    expect(mystPublicationManifestSchema.safeParse(manifest).success).toBe(true);
  });

  it.each(fixture.claimRecords.map((record, index) => [index, record] as const))(
    "accepts a valid claim record: %i",
    (_index, record) => {
      expect(validateClaim(clone(record)), JSON.stringify(validateClaim.errors)).toBe(true);
      expect(mystClaimRecordSchema.safeParse(record).success).toBe(true);
    },
  );

  /**
   * Each mutation is something a drifting producer, or a hostile one, could emit. Both
   * readers must reject it; if only one does, ORAtlas's re-expression has moved away from the
   * contract and this test is the thing that says so.
   */
  const invalidManifests: Array<[string, (manifest: Record<string, unknown>) => void]> = [
    ["an unknown top-level key", (manifest) => void (manifest.extra = true)],
    ["a future schema version", (manifest) => void (manifest.schemaVersion = "0.3.0")],
    [
      "an unimplemented adapter",
      (manifest) => void (manifest.adapter = { type: "quarto", xref: "q.json" }),
    ],
    [
      "a digest that is not a digest",
      (manifest) =>
        void ((manifest.artifacts as { claims: Record<string, unknown> }).claims.sha256 = "nope"),
    ],
    [
      "a declaration authority outside the vocabulary",
      (manifest) =>
        void ((manifest.artifacts as { claims: Record<string, unknown> }).claims.declarations =
          "whoever"),
    ],
    [
      "a missing version digest",
      (manifest) => void delete (manifest.publication as Record<string, unknown>).version,
    ],
  ];

  it.each(invalidManifests)("rejects a manifest with %s in both readers", (_label, mutate) => {
    const manifest = clone(fixture.manifest);
    mutate(manifest);
    expect(validateManifest(manifest)).toBe(false);
    expect(mystPublicationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  const invalidClaims: Array<[string, (record: Record<string, unknown>) => void]> = [
    ["an unknown key", (record) => void (record.extra = true)],
    ["a future schema version", (record) => void (record.schemaVersion = "0.3.0")],
    ["an unrecognised claim type", (record) => void (record.claimType = "vibes")],
    [
      "an identifier that is not a source-local claim id",
      (record) => void (record.id = "Not A Local Id"),
    ],
    [
      "an unimplemented target variant",
      (record) => void (record.target = { type: "jats-id", identifier: "x" }),
    ],
    [
      "a selector in ORAtlas's own rendered frame",
      (record) =>
        void ((record.selector as Record<string, unknown>).representation =
          "myst-rendered-text-v1"),
    ],
  ];

  it.each(invalidClaims)("rejects a claim record with %s in both readers", (_label, mutate) => {
    const record = clone(fixture.claimRecords[0]!);
    mutate(record);
    expect(validateClaim(record)).toBe(false);
    expect(mystClaimRecordSchema.safeParse(record).success).toBe(false);
  });
});

/**
 * The pinned JSON Schemas are generated from the producer's own Zod definitions, and
 * generation cannot express a cross-field or predicate rule: the safe-path rule (SPEC §3),
 * the https-only canonical URL (SPEC §5) and `endLine >= startLine` (SPEC §8) are all
 * normative prose that the JSON Schema shape leaves as a plain string or number.
 *
 * So the pinned schema is a **lower bound** on what conforms, and ORAtlas is deliberately
 * stricter. Asserting that asymmetry explicitly is the point: if a future re-pin made the
 * JSON Schema express one of these, this test would fail and someone would have to decide
 * which side moved, rather than the extra strictness quietly disappearing.
 */
describe("ORAtlas is stricter than the generated JSON Schema, deliberately", () => {
  const strongerManifestRules: Array<[string, (manifest: Record<string, unknown>) => void]> = [
    [
      "a declared path that escapes the publication root",
      (manifest) =>
        void ((manifest.artifacts as { claims: Record<string, unknown> }).claims.path =
          "../secrets"),
    ],
    [
      "an absolute declared path",
      (manifest) =>
        void ((manifest.artifacts as { claims: Record<string, unknown> }).claims.path =
          "/etc/passwd"),
    ],
    [
      "a plaintext canonical URL",
      (manifest) =>
        void ((manifest.publication as Record<string, unknown>).canonicalUrl =
          "http://example.org/"),
    ],
  ];

  it.each(strongerManifestRules)("enforces %s that the schema shape cannot", (_label, mutate) => {
    const manifest = clone(fixture.manifest);
    mutate(manifest);
    expect(validateManifest(manifest)).toBe(true);
    expect(mystPublicationManifestSchema.safeParse(manifest).success).toBe(false);
  });

  it("enforces that a claim's line span does not run backwards", () => {
    const record = clone(fixture.claimRecords[0]!);
    (record.source as Record<string, unknown>).startLine = 10_000;
    expect(validateClaim(record)).toBe(true);
    expect(mystClaimRecordSchema.safeParse(record).success).toBe(false);
  });
});
