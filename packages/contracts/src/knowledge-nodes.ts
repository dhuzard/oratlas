import { z } from "zod";
import { nodeEdgeProvenanceSchema, nodeEdgeStatusSchema, nodeRelationTypeSchema } from "./enums.js";
import { doiSchema, commitShaSchema, httpsUrlSchema } from "./identifiers.js";
import { manifestContributorSchema } from "./manifest.js";
import { safeRepoRelativePathSchema } from "./paths.js";

/** Contract version for repository node declarations. */
export const NODE_MANIFEST_SCHEMA_VERSION = "1.0.0";

/** Extraction caps consumed by downstream transports in KG-03. */
export const MAX_NODE_MANIFEST_BYTES = 1_000_000;
export const MAX_NODE_RECORD_BYTES = 1_000_000;
export const MAX_NODE_SOURCE_FILES = 5_000;

/** Stable identifier within the declaring repository. */
export const localNodeIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, {
    message:
      "Must start with an alphanumeric character and contain only letters, digits, '.', '_', ':', or '-'.",
  });

/** Source information retained with every immutable node version. */
export const knowledgeNodeProvenanceSchema = z
  .object({
    sourcePath: safeRepoRelativePathSchema,
    sourcePointer: z.string().min(1).max(512).optional(),
    repositoryUrl: httpsUrlSchema.optional(),
    commitSha: commitShaSchema.optional(),
    declaredAt: z.string().datetime().optional(),
  })
  .strict();
export type KnowledgeNodeProvenance = z.infer<typeof knowledgeNodeProvenanceSchema>;

const knowledgeNodeEnvelope = {
  id: localNodeIdSchema,
  title: z.string().min(1).max(500),
  abstract: z.string().min(1).max(10_000).optional(),
  text: z.string().min(1).max(100_000).optional(),
  contributors: z.array(manifestContributorSchema).max(200),
  license: z.string().min(1).max(120),
  provenance: knowledgeNodeProvenanceSchema,
  versionDoi: doiSchema.optional(),
  conceptDoi: doiSchema.optional(),
};

export const claimNodePayloadSchema = z
  .object({
    statement: z.string().min(1).max(10_000),
    qualifiers: z.array(z.string().min(1).max(2_000)).max(50).default([]),
  })
  .strict();

export const figureNodePayloadSchema = z
  .object({
    artifactPath: safeRepoRelativePathSchema,
    caption: z.string().min(1).max(10_000),
    altText: z.string().min(1).max(2_000).optional(),
  })
  .strict();

export const datasetNodePayloadSchema = z
  .object({
    artifactPath: safeRepoRelativePathSchema.optional(),
    format: z.string().min(1).max(120),
    sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    doi: doiSchema.optional(),
  })
  .strict();

export const codeNodePayloadSchema = z
  .object({
    entryPoints: z.array(safeRepoRelativePathSchema).min(1).max(100),
    language: z.string().min(1).max(120),
    releaseRef: z.string().min(1).max(200),
  })
  .strict();

export const claimNodeSchema = z
  .object({
    ...knowledgeNodeEnvelope,
    kind: z.literal("claim"),
    payload: claimNodePayloadSchema,
  })
  .strict();

export const figureNodeSchema = z
  .object({
    ...knowledgeNodeEnvelope,
    kind: z.literal("figure"),
    payload: figureNodePayloadSchema,
  })
  .strict();

export const datasetNodeSchema = z
  .object({
    ...knowledgeNodeEnvelope,
    kind: z.literal("dataset"),
    payload: datasetNodePayloadSchema,
  })
  .strict();

export const codeNodeSchema = z
  .object({
    ...knowledgeNodeEnvelope,
    kind: z.literal("code"),
    payload: codeNodePayloadSchema,
  })
  .strict();

export const knowledgeNodeSchema = z
  .discriminatedUnion("kind", [
    claimNodeSchema,
    figureNodeSchema,
    datasetNodeSchema,
    codeNodeSchema,
  ])
  .superRefine((node, context) => {
    if (node.versionDoi && node.conceptDoi && node.versionDoi === node.conceptDoi) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["conceptDoi"],
        message: "Concept DOI must be distinct from version DOI.",
      });
    }
    if (
      node.kind === "dataset" &&
      !node.payload.artifactPath &&
      !node.payload.doi &&
      !node.versionDoi &&
      !node.conceptDoi
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload", "artifactPath"],
        message: "Dataset must declare a repository artifact path or DOI.",
      });
    }
  });
export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>;

const nodeEdgeDeclarationFields = {
  sourceNodeId: localNodeIdSchema,
  targetNodeId: localNodeIdSchema,
  targetRepository: z
    .object({
      githubRepositoryId: z.string().regex(/^\d+$/).max(30),
      commitSha: commitShaSchema,
    })
    .strict()
    .optional(),
  relationType: nodeRelationTypeSchema,
  rationale: z.string().min(1).max(4_000).optional(),
  assertedAt: z.string().datetime().optional(),
};

/** Untrusted repository declaration. Lifecycle state is assigned only by Atlas. */
export const nodeEdgeDeclarationSchema = z.object(nodeEdgeDeclarationFields).strict();
export type NodeEdgeDeclaration = z.infer<typeof nodeEdgeDeclarationSchema>;

/**
 * KG-01 manifests included platform lifecycle fields. Continue accepting those
 * captures, but deliberately discard them so a repository can never claim an
 * editor confirmation.
 */
export const legacyNodeEdgeDeclarationSchema = z
  .object({
    ...nodeEdgeDeclarationFields,
    provenance: nodeEdgeProvenanceSchema,
    status: nodeEdgeStatusSchema,
  })
  .strict()
  .transform(({ provenance: _provenance, status: _status, ...declaration }) => declaration);

export const repositoryNodeEdgeDeclarationSchema = z.union([
  nodeEdgeDeclarationSchema,
  legacyNodeEdgeDeclarationSchema,
]);

/** Platform lifecycle projection. This shape is never accepted from a repository. */
export const nodeEdgeSchema = z
  .object({
    ...nodeEdgeDeclarationFields,
    provenance: nodeEdgeProvenanceSchema,
    status: nodeEdgeStatusSchema,
  })
  .strict();
export type NodeEdge = z.infer<typeof nodeEdgeSchema>;

export const nodeEdgeDecisionSchema = z
  .object({
    decision: z.enum(["confirm", "reject", "supersede"]),
    expectedRevision: z.number().int().nonnegative(),
    note: z.string().trim().min(10).max(4_000),
  })
  .strict();
export type NodeEdgeDecision = z.infer<typeof nodeEdgeDecisionSchema>;

const uniqueSafePathsSchema = z
  .array(safeRepoRelativePathSchema)
  .min(1)
  .max(MAX_NODE_SOURCE_FILES)
  .refine((paths) => new Set(paths).size === paths.length, {
    message: "Source file paths must be unique.",
  });

/** A repository can declare records as individual JSON files or one JSONL stream. */
export const nodeManifestSourceSchema = z.discriminatedUnion("format", [
  z
    .object({
      format: z.literal("json"),
      files: uniqueSafePathsSchema,
    })
    .strict(),
  z
    .object({
      format: z.literal("jsonl"),
      path: safeRepoRelativePathSchema,
    })
    .strict(),
]);
export type NodeManifestSource = z.infer<typeof nodeManifestSourceSchema>;

export const nodeManifestTrustSourceSchema = z
  .object({
    format: z.literal("jsonl"),
    path: safeRepoRelativePathSchema,
  })
  .strict();
export type NodeManifestTrustSource = z.infer<typeof nodeManifestTrustSourceSchema>;

export const nodeManifestSchema = z
  .object({
    schemaVersion: z.literal(NODE_MANIFEST_SCHEMA_VERSION),
    nodes: nodeManifestSourceSchema,
    edges: nodeManifestSourceSchema.optional(),
    trustAssessments: nodeManifestTrustSourceSchema.optional(),
  })
  .strict();
export type NodeManifest = z.infer<typeof nodeManifestSchema>;

export interface NodeManifestValidationResult {
  ok: boolean;
  manifest?: NodeManifest;
  errors: string[];
}

/** Validate parsed, untrusted JSON and return stable, readable issue paths. */
export function validateNodeManifest(value: unknown): NodeManifestValidationResult {
  const parsed = nodeManifestSchema.safeParse(value);
  if (parsed.success) {
    return { ok: true, manifest: parsed.data, errors: [] };
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      return `${issue.path.join(".") || "(root)"}: ${issue.message}`;
    }),
  };
}
