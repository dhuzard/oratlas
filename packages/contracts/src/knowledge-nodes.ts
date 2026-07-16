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

export const claimNodeSchema = z
  .object({
    ...knowledgeNodeEnvelope,
    kind: z.literal("claim"),
    payload: z
      .object({
        statement: z.string().min(1).max(10_000),
        qualifiers: z.array(z.string().min(1).max(2_000)).max(50).default([]),
      })
      .strict(),
  })
  .strict();

export const figureNodeSchema = z
  .object({
    ...knowledgeNodeEnvelope,
    kind: z.literal("figure"),
    payload: z
      .object({
        artifactPath: safeRepoRelativePathSchema,
        caption: z.string().min(1).max(10_000),
        altText: z.string().min(1).max(2_000).optional(),
      })
      .strict(),
  })
  .strict();

export const datasetNodeSchema = z
  .object({
    ...knowledgeNodeEnvelope,
    kind: z.literal("dataset"),
    payload: z
      .object({
        artifactPath: safeRepoRelativePathSchema.optional(),
        format: z.string().min(1).max(120),
        sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
        doi: doiSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const codeNodeSchema = z
  .object({
    ...knowledgeNodeEnvelope,
    kind: z.literal("code"),
    payload: z
      .object({
        entryPoints: z.array(safeRepoRelativePathSchema).min(1).max(100),
        language: z.string().min(1).max(120),
        releaseRef: z.string().min(1).max(200),
      })
      .strict(),
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

export const nodeEdgeSchema = z
  .object({
    sourceNodeId: localNodeIdSchema,
    targetNodeId: localNodeIdSchema,
    relationType: nodeRelationTypeSchema,
    provenance: nodeEdgeProvenanceSchema,
    status: nodeEdgeStatusSchema,
    rationale: z.string().min(1).max(4_000).optional(),
    assertedAt: z.string().datetime().optional(),
  })
  .strict();
export type NodeEdge = z.infer<typeof nodeEdgeSchema>;

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

export const nodeManifestSchema = z
  .object({
    schemaVersion: z.literal(NODE_MANIFEST_SCHEMA_VERSION),
    nodes: nodeManifestSourceSchema,
    edges: nodeManifestSourceSchema.optional(),
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
