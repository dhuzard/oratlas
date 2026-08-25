import { z } from "zod";
import {
  MYST_CLAIM_RECORD_PROTOCOL_VERSION,
  MYST_LEGACY_PUBLICATION_PROTOCOL_VERSION,
  MYST_PUBLICATION_PROTOCOL_VERSION,
  MYST_SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS,
  PUBLICATION_BOUNDARY_SCHEMA_VERSION,
  claimTypeSchema,
  normalizedPublicationContributorsSchema,
  normalizedPublicationProductionAssertionSchema,
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
  publicationArtifactIdentitySha256,
  type CapturedPublicationArtifact,
  type NormalizedPublication,
  type PublicationAdapter,
  type PublicationAdapterNormalizationContext,
} from "../adapter.js";
import { normalizeMystPublicationContent } from "./myst-content.js";

/**
 * The `myst` adapter: closed dhuzard/oratlas-myst manifest schemas 0.2.0 and 0.3.0.
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

const mystGeneratorSchema = z
  .object({ name: z.string().min(1).max(120), version: z.string().min(1).max(60) })
  .strict();

const mystPublicationSchema = z
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
  .strict();

const mystAdapterSchema = z
  .object({ type: z.literal("myst"), xref: safeRepoRelativePathSchema })
  .strict();

const mystArtifactsSchema = z
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
  .strict();

const mystOratlasSchema = z.object({ reviewManifest: safeRepoRelativePathSchema }).strict();

const mystContributorIdentifierSchema = z
  .object({
    scheme: z.enum(["orcid", "ror", "isni", "other"]),
    value: z.string().trim().min(1).max(300),
  })
  .strict()
  .superRefine((identifier, context) => {
    if (identifier.scheme !== "orcid") return;
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(identifier.value)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Invalid ORCID." });
      return;
    }
    const compact = identifier.value.replaceAll("-", "");
    let total = 0;
    for (const digit of compact.slice(0, 15)) total = (total + Number(digit)) * 2;
    const result = (12 - (total % 11)) % 11;
    if (compact.at(-1) !== (result === 10 ? "X" : String(result))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "Invalid ORCID." });
    }
  });

const mystContributorCommonShape = {
  sourceContributorKey: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  displayName: z.string().trim().min(1).max(300),
  identifiers: z.array(mystContributorIdentifierSchema).max(20).optional(),
  affiliations: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  roles: z
    .array(
      z.enum(["author", "corresponding-author", "editor", "group-author", "contributor", "other"]),
    )
    .min(1)
    .max(6),
  position: z.number().int().positive().max(500),
  publicUrl: publicationHttpsUrlSchema.optional(),
} as const;

const mystContributorSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("person"),
        ...mystContributorCommonShape,
        givenName: z.string().trim().min(1).max(200).optional(),
        familyName: z.string().trim().min(1).max(200).optional(),
      })
      .strict(),
    z.object({ kind: z.literal("organization"), ...mystContributorCommonShape }).strict(),
  ])
  .superRefine((contributor, context) => {
    const invalidIdentifier = contributor.identifiers?.find(
      (identifier) =>
        (contributor.kind === "person" && identifier.scheme === "ror") ||
        (contributor.kind === "organization" && identifier.scheme === "orcid"),
    );
    if (invalidIdentifier) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["identifiers"],
        message: "Contributor identifier scheme does not match contributor kind.",
      });
    }
    for (const [path, values] of [
      [
        "identifiers",
        (contributor.identifiers ?? []).map(
          (identifier) => `${identifier.scheme}:${identifier.value}`,
        ),
      ],
      ["affiliations", contributor.affiliations ?? []],
      ["roles", contributor.roles],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [path],
          message: `${path} must not contain duplicates.`,
        });
      }
    }
  });

const mystContributorsSchema = z
  .array(mystContributorSchema)
  .max(500)
  .superRefine((contributors, context) => {
    const keys = new Set<string>();
    contributors.forEach((contributor, index) => {
      if (keys.has(contributor.sourceContributorKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "sourceContributorKey"],
          message: "Source contributor keys must be unique within a publication version.",
        });
      }
      if (contributor.position !== index + 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "position"],
          message: "Contributor positions must be contiguous and match declared array order.",
        });
      }
      keys.add(contributor.sourceContributorKey);
    });
  });

const mystProductionActorSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    kind: z.enum(["person", "organization", "software", "workflow", "ai-system"]),
    name: z.string().trim().min(1).max(300).optional(),
    identifier: z.string().trim().min(1).max(500).optional(),
    version: z.string().trim().min(1).max(120).optional(),
    provider: z.string().trim().min(1).max(200).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    modelVersion: z.string().trim().min(1).max(120).optional(),
    publicUrl: publicationHttpsUrlSchema.optional(),
    activities: z
      .array(
        z.enum([
          "study-design",
          "evidence-search",
          "evidence-synthesis",
          "data-analysis",
          "drafting",
          "authoring",
          "editing",
          "reviewing",
          "figure-generation",
          "code-generation",
          "other",
        ]),
      )
      .min(1)
      .max(11),
  })
  .strict()
  .superRefine((actor, context) => {
    if (actor.name === undefined && actor.identifier === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["name"],
        message: "A production actor requires a declared name or identifier.",
      });
    }
    if (new Set(actor.activities).size !== actor.activities.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activities"],
        message: "activities must not contain duplicates.",
      });
    }
  });

const mystProductionSchema = z
  .object({
    sourceAssertionKey: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    strength: z.literal("source-declared"),
    mode: z.enum(["human", "ai-assisted", "agentic", "hybrid", "unspecified"]),
    actors: z.array(mystProductionActorSchema).max(64),
    statement: z.string().trim().min(1).max(5_000).optional(),
    publicEvidenceUrl: publicationHttpsUrlSchema.optional(),
  })
  .strict()
  .superRefine((production, context) => {
    const ids = new Set<string>();
    production.actors.forEach((actor, index) => {
      if (ids.has(actor.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["actors", index, "id"],
          message: "Production actor ids must be unique within an assertion.",
        });
      }
      ids.add(actor.id);
    });
  });

const mystManifestCommonShape = {
  generator: mystGeneratorSchema,
  publication: mystPublicationSchema,
  adapter: mystAdapterSchema,
  artifacts: mystArtifactsSchema,
  oratlas: mystOratlasSchema.optional(),
} as const;

/** Frozen `oratlas.manifest.json`, schema version 0.2.0. */
export const mystPublicationManifestV020Schema = z
  .object({
    schemaVersion: z.literal(MYST_LEGACY_PUBLICATION_PROTOCOL_VERSION),
    ...mystManifestCommonShape,
  })
  .strict();

/** Current `oratlas.manifest.json`, schema version 0.3.0. */
export const mystPublicationManifestV030Schema = z
  .object({
    schemaVersion: z.literal(MYST_PUBLICATION_PROTOCOL_VERSION),
    ...mystManifestCommonShape,
    contributors: mystContributorsSchema.optional(),
    production: mystProductionSchema.optional(),
  })
  .strict();

/** Closed, version-discriminated acceptance contract for 0.2.0 and 0.3.0. */
export const mystPublicationManifestSchema = z.discriminatedUnion("schemaVersion", [
  mystPublicationManifestV020Schema,
  mystPublicationManifestV030Schema,
]);
export type MystPublicationManifest = z.infer<typeof mystPublicationManifestSchema>;

/** One record of `oratlas/claims.jsonl`, schema version 0.2.0. Closed object. */
export const mystClaimRecordSchema = z
  .object({
    schemaVersion: z.literal(MYST_CLAIM_RECORD_PROTOCOL_VERSION),
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
  /** Exact captured manifest artifact used as contributor declaration provenance. */
  manifestArtifact?: CapturedPublicationArtifact & {
    artifactKind: "publication-manifest";
    requestedUrl?: string;
    observedUrl?: string;
  };
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

  const contributors = (() => {
    if (manifest.schemaVersion !== MYST_PUBLICATION_PROTOCOL_VERSION) return undefined;
    if (manifest.contributors === undefined) return undefined;
    if (input.manifestArtifact === undefined) {
      throw new PublicationAdapterError(
        "MyST 0.3 contributor declarations require the exact captured publication manifest.",
      );
    }
    const sourceDeclarationProvenance = {
      type: "source-declared" as const,
      sourceArtifactKind: "publication-manifest" as const,
      sourceArtifactIdentitySha256: publicationArtifactIdentitySha256(input.manifestArtifact),
      sourceArtifactSha256: input.manifestArtifact.contentSha256,
    };
    return normalizedPublicationContributorsSchema.parse(
      manifest.contributors.map((contributor) => ({
        sourceContributorKey: contributor.sourceContributorKey,
        kind: contributor.kind,
        displayName: contributor.displayName,
        ...(contributor.kind === "person" && contributor.givenName !== undefined
          ? { givenName: contributor.givenName }
          : {}),
        ...(contributor.kind === "person" && contributor.familyName !== undefined
          ? { familyName: contributor.familyName }
          : {}),
        identifiers: [...(contributor.identifiers ?? [])],
        affiliations: [...(contributor.affiliations ?? [])],
        roles: [...contributor.roles],
        position: contributor.position,
        ...(contributor.publicUrl === undefined ? {} : { publicUrl: contributor.publicUrl }),
        sourceDeclarationProvenance,
      })),
    );
  })();

  const productionAssertions = (() => {
    if (
      manifest.schemaVersion !== MYST_PUBLICATION_PROTOCOL_VERSION ||
      manifest.production === undefined
    ) {
      return undefined;
    }
    const seenActivities = new Set<string>();
    const activities = manifest.production.actors.flatMap((actor) =>
      actor.activities.filter((activity) => {
        if (seenActivities.has(activity)) return false;
        seenActivities.add(activity);
        return true;
      }),
    );
    return [
      normalizedPublicationProductionAssertionSchema.parse({
        sourceAssertionKey: manifest.production.sourceAssertionKey,
        strength: manifest.production.strength,
        mode: manifest.production.mode,
        actors: manifest.production.actors.map((actor) => ({
          kind: actor.kind,
          ...(actor.name === undefined ? {} : { name: actor.name }),
          ...(actor.identifier === undefined ? {} : { identifier: actor.identifier }),
          ...(actor.version === undefined ? {} : { version: actor.version }),
          ...(actor.provider === undefined ? {} : { provider: actor.provider }),
          ...(actor.model === undefined ? {} : { model: actor.model }),
          ...(actor.modelVersion === undefined ? {} : { modelVersion: actor.modelVersion }),
          ...(actor.publicUrl === undefined ? {} : { publicUrl: actor.publicUrl }),
        })),
        activities,
        ...(manifest.production.statement === undefined
          ? {}
          : { statement: manifest.production.statement }),
        ...(manifest.production.publicEvidenceUrl === undefined
          ? {}
          : { publicEvidenceUrl: manifest.production.publicEvidenceUrl }),
      }),
    ];
  })();

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
      protocolVersion: manifest.schemaVersion,
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

  return {
    publication,
    version,
    occurrences,
    ...(contributors === undefined ? {} : { contributors }),
    ...(productionAssertions === undefined ? {} : { productionAssertions }),
  };
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
  manifestArtifact?: CapturedPublicationArtifact & {
    artifactKind: "publication-manifest";
    requestedUrl?: string;
    observedUrl?: string;
  };
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

/** MyST manifest protocols 0.2.0 and 0.3.0 as one generic format adapter. */
export const mystPublicationAdapter: PublicationAdapter<
  MystPublicationManifest,
  MystAdapterArtifactsInput,
  MystPublishedStructureInput,
  MystAdapterNormalizeInput,
  MystPublishedTargetInput
> = {
  type: "myst",
  supportedProtocolVersions: MYST_SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS,
  recognizeManifest(value) {
    return (
      typeof value === "object" &&
      value !== null &&
      MYST_SUPPORTED_PUBLICATION_PROTOCOL_VERSIONS.some(
        (version) => version === (value as { schemaVersion?: unknown }).schemaVersion,
      ) &&
      typeof (value as { adapter?: unknown }).adapter === "object" &&
      (value as { adapter?: { type?: unknown } }).adapter?.type === "myst"
    );
  },
  validateManifest(value) {
    const parsed = mystPublicationManifestSchema.safeParse(value);
    if (!parsed.success) {
      throw new PublicationAdapterError(
        "The publication manifest does not satisfy the closed MyST 0.2.0/0.3.0 contract.",
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
      ...(input.manifestArtifact === undefined ? {} : { manifestArtifact: input.manifestArtifact }),
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
