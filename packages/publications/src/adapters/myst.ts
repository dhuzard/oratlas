import { z } from "zod";
import {
  MYST_PUBLICATION_PROTOCOL_VERSION,
  PUBLICATION_BOUNDARY_SCHEMA_VERSION,
  claimTypeSchema,
  publicationClaimOccurrenceRecordSchema,
  publicationClaimSelectorSchema,
  publicationClaimSourceBindingSchema,
  publicationHttpsUrlSchema,
  publicationRecordSchema,
  publicationSha256Schema,
  publicationVersionRecordSchema,
  safeRepoRelativePathSchema,
  sourceLocalClaimIdSchema,
  sourceLocalPublicationIdSchema,
  type PublicationStructuralProvenance,
  type PublicationType,
} from "@oratlas/contracts";
import {
  derivePublicationIdentityEvidence,
  publicationClaimOccurrenceStableKey,
  publicationStableKey,
  publicationVersionStableKey,
} from "../identity.js";
import {
  PublicationAdapterError,
  type CapturedPublicationArtifact,
  type NormalizedPublication,
  type PublicationAdapter,
  type PublicationAdapterNormalizationContext,
} from "../adapter.js";
import { normalizeMystPublicationContent } from "./myst-content.js";

/**
 * The `myst` adapter: dhuzard/oratlas-myst schema version 0.2.0.
 *
 * This module is pure. It never fetches, never resolves a URL, never touches
 * the filesystem, and never executes publication content: it validates
 * artifacts a caller already holds and normalizes them into the generic
 * publication boundary. Registration and fetching are separate concerns and
 * are deliberately not implemented here.
 *
 * Both external objects are **closed**: an unknown key is an error, not
 * something to ignore. An unimplemented `schemaVersion`, `adapter.type` or
 * `target.type` is rejected rather than partially read.
 */

/** Claim types the 0.2.0 protocol permits — a subset of ORAtlas's own list. */
const MYST_CLAIM_TYPES = [
  "empirical",
  "mechanistic",
  "methodological",
  "theoretical",
  "normative",
  "summary",
  "other",
  "synthesis",
  "model-derived",
  "translational",
] as const;
const mystClaimTypeSchema = z.enum(MYST_CLAIM_TYPES).pipe(claimTypeSchema);

const mystSourceDescriptorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("git"),
      repository: publicationHttpsUrlSchema,
      commit: z
        .string()
        .regex(/^[0-9a-f]{40}$|^[0-9a-f]{64}$/)
        .optional(),
      ref: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("doi"),
      versionDoi: z.string().regex(/^10\.\d{4,9}\/\S+$/),
      conceptDoi: z
        .string()
        .regex(/^10\.\d{4,9}\/\S+$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("archive"),
      url: publicationHttpsUrlSchema,
      sha256: publicationSha256Schema,
      format: z.string().min(1).max(40).optional(),
    })
    .strict(),
]);

/** `oratlas.manifest.json`, schema version 0.2.0. Closed object. */
export const mystPublicationManifestSchema = z
  .object({
    schemaVersion: z.literal(MYST_PUBLICATION_PROTOCOL_VERSION),
    generator: z
      .object({ name: z.string().min(1).max(120), version: z.string().min(1).max(60) })
      .strict(),
    publication: z
      .object({
        id: sourceLocalPublicationIdSchema.optional(),
        canonicalUrl: publicationHttpsUrlSchema.optional(),
        title: z.string().min(1).max(500).optional(),
        version: z
          .object({
            sourcesSha256: publicationSha256Schema,
            label: z.string().min(1).max(120).optional(),
          })
          .strict(),
        source: mystSourceDescriptorSchema.optional(),
      })
      .strict(),
    adapter: z.discriminatedUnion("type", [
      z.object({ type: z.literal("myst"), xref: safeRepoRelativePathSchema }).strict(),
    ]),
    artifacts: z
      .object({
        claims: z
          .object({
            path: safeRepoRelativePathSchema,
            format: z.literal("jsonl"),
            records: z.number().int().min(0).max(1_000_000),
            sha256: publicationSha256Schema,
            declarations: z.enum(["publication-source", "review-manifest"]),
          })
          .strict(),
      })
      .strict(),
    oratlas: z.object({ reviewManifest: safeRepoRelativePathSchema }).strict().optional(),
  })
  .strict();
export type MystPublicationManifest = z.infer<typeof mystPublicationManifestSchema>;

/** One record of `oratlas/claims.jsonl`, schema version 0.2.0. Closed object. */
export const mystClaimRecordSchema = z
  .object({
    schemaVersion: z.literal(MYST_PUBLICATION_PROTOCOL_VERSION),
    id: sourceLocalClaimIdSchema,
    text: z.string().min(1).max(5_000).optional(),
    claimType: mystClaimTypeSchema.optional(),
    qualification: z.string().min(1).max(2_000).optional(),
    target: z.discriminatedUnion("type", [
      z
        .object({
          type: z.literal("myst-xref"),
          identifier: sourceLocalClaimIdSchema,
          htmlId: z.string().min(1).max(300),
        })
        .strict(),
    ]),
    source: publicationClaimSourceBindingSchema,
    selector: publicationClaimSelectorSchema,
    declarationSha256: publicationSha256Schema,
  })
  .strict();
export type MystClaimRecord = z.infer<typeof mystClaimRecordSchema>;

export interface NormalizeMystPublicationInput {
  /** Parsed `oratlas.manifest.json`, exactly as observed. */
  manifest: unknown;
  /** Parsed `oratlas/claims.jsonl` records, in artifact order. */
  claims: readonly unknown[];
  /**
   * The 0.2.0 protocol declares no publication type, so ORAtlas supplies one at
   * registration rather than inferring it from the artifacts.
   */
  publicationType: PublicationType;
  /** The structural provenance level actually reached. Never asserted, always passed in. */
  structuralProvenance: PublicationStructuralProvenance;
  /** RFC 3339 timestamp of the observation. */
  observedAt: string;
  /** Opaque ORAtlas registration key, used only when no durable evidence exists. */
  registrationKey?: string;
  /** Authoritative declarations loaded from a delegated ORAtlas review-manifest stream. */
  delegatedDeclarations?: ReadonlyMap<
    string,
    { text: string; claimType?: string; qualification?: string }
  >;
  /** Persisted explanation of any source-byte verification limitation. */
  verificationWarnings?: readonly string[];
}

/** UTF-16 code-unit comparison, as the protocol's ordering rule requires. */
function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function assertProtocolOrdering(records: readonly MystClaimRecord[]): void {
  for (let index = 1; index < records.length; index++) {
    const previous = records[index - 1]!;
    const current = records[index]!;
    const ordered =
      compareCodeUnits(previous.source.documentPath, current.source.documentPath) < 0 ||
      (previous.source.documentPath === current.source.documentPath &&
        (previous.source.startLine < current.source.startLine ||
          (previous.source.startLine === current.source.startLine &&
            compareCodeUnits(previous.id, current.id) < 0)));
    if (!ordered) {
      throw new PublicationAdapterError(
        "Claim records are not in the protocol's required document/line/id order.",
      );
    }
  }
}

/**
 * Validate and normalize one observed MyST publication into generic records.
 *
 * This establishes structural provenance and nothing more. Every normalized
 * record is a publication source assertion: none of them is confirmed,
 * verified, endorsed, or bound to a canonical graph identity here.
 */
export function normalizeMystPublication(
  input: NormalizeMystPublicationInput,
): NormalizedPublication {
  const manifest = mystPublicationManifestSchema.parse(input.manifest);
  const records = input.claims.map((claim) => mystClaimRecordSchema.parse(claim));

  if (manifest.artifacts.claims.records !== records.length) {
    throw new PublicationAdapterError(
      "The manifest's declared record count does not match the claims artifact.",
    );
  }
  const seen = new Set<string>();
  for (const record of records) {
    if (record.target.identifier !== record.id) {
      throw new PublicationAdapterError(
        "A claim record's target identifier does not equal its source-local claim id.",
      );
    }
    if (seen.has(record.id)) {
      throw new PublicationAdapterError(
        `Source-local claim id "${record.id}" is declared more than once in one publication version.`,
      );
    }
    seen.add(record.id);
  }
  assertProtocolOrdering(records);

  const authority = manifest.artifacts.claims.declarations;
  if (authority === "review-manifest" && manifest.oratlas === undefined) {
    throw new PublicationAdapterError(
      "Declaration authority is review-manifest but the manifest declares no review manifest.",
    );
  }
  for (const record of records) {
    const carriesDeclaration =
      record.text !== undefined ||
      record.claimType !== undefined ||
      record.qualification !== undefined;
    if (authority === "publication-source" && record.text === undefined) {
      throw new PublicationAdapterError(
        `Claim "${record.id}" carries no text although the publication source is authoritative.`,
      );
    }
    if (authority === "review-manifest" && carriesDeclaration) {
      throw new PublicationAdapterError(
        `Claim "${record.id}" restates a declaration owned by the review manifest.`,
      );
    }
  }
  if (authority === "review-manifest") {
    if (input.delegatedDeclarations !== undefined) {
      const recordIds = new Set(records.map((record) => record.id));
      for (const id of recordIds) {
        if (!input.delegatedDeclarations.has(id)) {
          throw new PublicationAdapterError(
            `The authoritative review-manifest claim stream does not declare claim "${id}".`,
          );
        }
      }
      for (const id of input.delegatedDeclarations.keys()) {
        if (!recordIds.has(id)) {
          throw new PublicationAdapterError(
            `The authoritative review-manifest claim "${id}" has no MyST source occurrence.`,
          );
        }
      }
    }
  }

  const identityEvidence = derivePublicationIdentityEvidence({
    ...(manifest.publication.id === undefined
      ? {}
      : { sourceLocalPublicationId: manifest.publication.id }),
    ...(manifest.publication.canonicalUrl === undefined
      ? {}
      : { canonicalUrl: manifest.publication.canonicalUrl }),
    ...(manifest.publication.source === undefined ? {} : { source: manifest.publication.source }),
    ...(input.registrationKey === undefined ? {} : { registrationKey: input.registrationKey }),
  });
  const publicationKey = publicationStableKey(identityEvidence);
  const versionKey = publicationVersionStableKey(
    publicationKey,
    manifest.publication.version.sourcesSha256,
  );

  const publication = publicationRecordSchema.parse({
    schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
    stableKey: publicationKey,
    publicationType: input.publicationType,
    recordSource: "external-publication",
    identityEvidence,
    ...(manifest.publication.id === undefined
      ? {}
      : { sourceLocalPublicationId: manifest.publication.id }),
  });

  const version = publicationVersionRecordSchema.parse({
    schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
    stableKey: versionKey,
    publicationStableKey: publicationKey,
    ...(manifest.publication.id === undefined
      ? {}
      : { sourceLocalPublicationId: manifest.publication.id }),
    sourcesSha256: manifest.publication.version.sourcesSha256,
    ...(manifest.publication.version.label === undefined
      ? {}
      : { versionLabel: manifest.publication.version.label }),
    ...(manifest.publication.title === undefined ? {} : { title: manifest.publication.title }),
    ...(manifest.publication.canonicalUrl === undefined
      ? {}
      : { canonicalUrl: manifest.publication.canonicalUrl }),
    adapter: {
      type: "myst",
      protocolVersion: MYST_PUBLICATION_PROTOCOL_VERSION,
      crossReferenceInventoryPath: manifest.adapter.xref,
      generatorName: manifest.generator.name,
      generatorVersion: manifest.generator.version,
    },
    ...(manifest.publication.source === undefined ? {} : { source: manifest.publication.source }),
    structuralProvenance: input.structuralProvenance,
    verificationWarnings: [...(input.verificationWarnings ?? [])],
    observedAt: input.observedAt,
  });

  const occurrences = records.map((record) =>
    publicationClaimOccurrenceRecordSchema.parse({
      schemaVersion: PUBLICATION_BOUNDARY_SCHEMA_VERSION,
      stableKey: publicationClaimOccurrenceStableKey(versionKey, record.id),
      publicationVersionStableKey: versionKey,
      sourceLocalClaimId: record.id,
      target: record.target,
      sourceBinding: record.source,
      selector: record.selector,
      declarationSha256: record.declarationSha256,
      declaration:
        authority === "publication-source"
          ? {
              authority: "publication-source",
              text: record.text,
              ...(record.claimType === undefined ? {} : { claimType: record.claimType }),
              ...(record.qualification === undefined
                ? {}
                : { qualification: record.qualification }),
            }
          : { authority: "review-manifest" },
    }),
  );

  return { publication, version, occurrences };
}

export interface MystAdapterArtifactsInput {
  manifest: MystPublicationManifest;
  artifacts: readonly CapturedPublicationArtifact[];
}

export interface MystPublishedStructureInput {
  claims: readonly MystClaimRecord[];
  /** Claim ids whose inventory target and published page node were both checked. */
  verifiedClaimIds: ReadonlySet<string>;
}

export interface MystAdapterNormalizeInput {
  manifest: MystPublicationManifest;
  claims: readonly MystClaimRecord[];
  delegatedDeclarations?: ReadonlyMap<
    string,
    { text: string; claimType?: string; qualification?: string }
  >;
}

export interface MystPublishedTargetInput {
  publicationBaseUrl: string;
  inventoryUrl: string;
  htmlId?: string;
}

function resolveMystAdapterPublishedTarget(input: MystPublishedTargetInput): string {
  const hasControlCharacter = Array.from(input.inventoryUrl).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  if (
    input.inventoryUrl.length > 2_000 ||
    !input.inventoryUrl.startsWith("/") ||
    input.inventoryUrl.startsWith("//") ||
    input.inventoryUrl.includes("\\") ||
    hasControlCharacter
  ) {
    throw new PublicationAdapterError("A MyST inventory entry has an unsafe published URL.");
  }
  const base = new URL(
    input.publicationBaseUrl.endsWith("/")
      ? input.publicationBaseUrl
      : `${input.publicationBaseUrl}/`,
  );
  const resolved = new URL(input.inventoryUrl.replace(/^\/+/, ""), base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    throw new PublicationAdapterError(
      "A MyST inventory URL resolves outside the publication root.",
    );
  }
  if (input.htmlId) resolved.hash = input.htmlId;
  return resolved.href;
}

/** Frozen MyST 0.2.0 as one implementation of the generic adapter boundary. */
export const mystPublicationAdapter: PublicationAdapter<
  MystPublicationManifest,
  MystAdapterArtifactsInput,
  MystPublishedStructureInput,
  MystAdapterNormalizeInput,
  MystPublishedTargetInput
> = {
  type: "myst",
  supportedProtocolVersions: [MYST_PUBLICATION_PROTOCOL_VERSION],
  recognizeManifest(value) {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as { schemaVersion?: unknown }).schemaVersion === MYST_PUBLICATION_PROTOCOL_VERSION &&
      typeof (value as { adapter?: unknown }).adapter === "object" &&
      (value as { adapter?: { type?: unknown } }).adapter?.type === "myst"
    );
  },
  validateManifest(value) {
    const parsed = mystPublicationManifestSchema.safeParse(value);
    if (!parsed.success) {
      throw new PublicationAdapterError(
        "The publication manifest does not satisfy the closed MyST 0.2.0 contract.",
      );
    }
    return parsed.data;
  },
  describeRequiredArtifacts(manifest) {
    return [
      {
        artifactKind: "claim-stream",
        declaredPath: manifest.artifacts.claims.path,
        required: true,
      },
      {
        artifactKind: "cross-reference-inventory",
        declaredPath: manifest.adapter.xref,
        required: true,
      },
      ...(manifest.oratlas
        ? [
            {
              artifactKind: "review-manifest" as const,
              declaredPath: manifest.oratlas.reviewManifest,
              required: manifest.artifacts.claims.declarations === "review-manifest",
            },
          ]
        : []),
    ];
  },
  validateCapturedArtifacts({ manifest, artifacts }) {
    for (const requirement of this.describeRequiredArtifacts(manifest)) {
      if (
        requirement.required &&
        !artifacts.some(
          (artifact) =>
            artifact.artifactKind === requirement.artifactKind &&
            artifact.declaredPath === requirement.declaredPath,
        )
      ) {
        throw new PublicationAdapterError(
          `The captured publication is missing ${requirement.artifactKind} '${requirement.declaredPath}'.`,
        );
      }
    }
    const claims = artifacts.find(
      (artifact) =>
        artifact.artifactKind === "claim-stream" &&
        artifact.declaredPath === manifest.artifacts.claims.path,
    );
    if (claims?.contentSha256 !== manifest.artifacts.claims.sha256) {
      throw new PublicationAdapterError("The captured claims digest does not match the manifest.");
    }
  },
  verifyPublishedStructure({ claims, verifiedClaimIds }) {
    for (const claim of claims) {
      if (!verifiedClaimIds.has(claim.id)) {
        throw new PublicationAdapterError(
          `Published structure does not contain the exact claim target '${claim.id}'.`,
        );
      }
    }
  },
  normalize(input, context: PublicationAdapterNormalizationContext) {
    return normalizeMystPublication({
      manifest: input.manifest,
      claims: input.claims,
      publicationType: context.publicationType,
      structuralProvenance: context.structuralProvenance,
      observedAt: context.observedAt,
      ...(context.registrationKey === undefined
        ? {}
        : { registrationKey: context.registrationKey }),
      ...(input.delegatedDeclarations === undefined
        ? {}
        : { delegatedDeclarations: input.delegatedDeclarations }),
      verificationWarnings: context.verificationWarnings ?? [],
    });
  },
  normalizeContent: normalizeMystPublicationContent,
  resolvePublishedTarget: resolveMystAdapterPublishedTarget,
};
