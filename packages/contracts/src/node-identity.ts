import { z } from "zod";
import { knowledgeNodeKindSchema } from "./enums.js";
import { canonicalizeDoi, canonicalizeOpenAlexId, canonicalizePmid } from "./evidence-identity.js";

export const NODE_IDENTITY_METHOD_VERSION = "oratlas-node-identity-1.0.0" as const;

export const nodeAliasSchemeSchema = z.enum(["doi", "pmid", "openalex"]);
export type NodeAliasScheme = z.infer<typeof nodeAliasSchemeSchema>;

/**
 * Alias roles preserve identifier meaning. In particular, version and concept
 * DOIs remain distinct even though both normalize into DOI comparison keys.
 */
export const nodeAliasRoleSchema = z.enum([
  "version-doi",
  "concept-doi",
  "artifact-doi",
  "work-doi",
  "work-pmid",
  "work-openalex",
]);
export type NodeAliasRole = z.infer<typeof nodeAliasRoleSchema>;

function schemeForRole(role: NodeAliasRole): NodeAliasScheme {
  return role.endsWith("-doi") ? "doi" : role === "work-pmid" ? "pmid" : "openalex";
}

function normalizedAliasValue(scheme: NodeAliasScheme, value: string): string | undefined {
  return scheme === "doi"
    ? canonicalizeDoi(value)
    : scheme === "pmid"
      ? canonicalizePmid(value)
      : canonicalizeOpenAlexId(value);
}

const rawNodeAliasSchema = z
  .object({
    scheme: nodeAliasSchemeSchema,
    role: nodeAliasRoleSchema,
    value: z.string().min(1).max(500),
    isExample: z.boolean().default(false),
  })
  .strict()
  .superRefine((alias, context) => {
    const expectedScheme = schemeForRole(alias.role);
    if (alias.scheme !== expectedScheme) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role"],
        message: `Alias role '${alias.role}' requires scheme '${expectedScheme}'.`,
      });
    }
    const normalized = normalizedAliasValue(alias.scheme, alias.value);
    if (!normalized) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `Must be a valid ${alias.scheme.toUpperCase()} alias.`,
      });
    }
    if (alias.scheme === "doi" && normalized?.startsWith("10.5555/") && !alias.isExample) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isExample"],
        message: "The reserved 10.5555 example prefix must be flagged as an example.",
      });
    }
  })
  .transform((alias) => ({
    ...alias,
    value: normalizedAliasValue(alias.scheme, alias.value) ?? alias.value,
  }));
export const nodeAliasSchema = rawNodeAliasSchema;
export type NodeAlias = z.infer<typeof nodeAliasSchema>;
export type NodeAliasInput = z.input<typeof nodeAliasSchema>;

/** Parse and canonicalize a runtime alias into its bare comparison value. */
export function canonicalizeNodeAlias(input: unknown): NodeAlias | undefined {
  const parsed = nodeAliasSchema.safeParse(input);
  return parsed.success ? parsed.data : undefined;
}

export const nodeIdentityCandidateSchema = z
  .object({
    knowledgeNodeId: z.string().min(1),
    repositoryId: z.string().min(1),
    localNodeId: z.string().min(1),
    kind: knowledgeNodeKindSchema,
    aliases: z.array(nodeAliasSchema).max(100).default([]),
    claim: z
      .object({
        statement: z.string().min(1).max(10_000),
        qualifiers: z.array(z.string().min(1).max(2_000)).max(50).default([]),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.kind === "claim" && !candidate.claim) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claim"],
        message: "Claim identity candidates require a statement and qualifiers.",
      });
    }
    if (candidate.kind !== "claim" && candidate.claim) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["claim"],
        message: "Only claim nodes may carry claim identity text.",
      });
    }
  });
export type NodeIdentityCandidate = z.infer<typeof nodeIdentityCandidateSchema>;

export const nodeIdentityProposalKindSchema = z.enum(["same-work", "same-claim"]);
export type NodeIdentityProposalKind = z.infer<typeof nodeIdentityProposalKindSchema>;

export const nodeIdentitySignalSchema = z.enum([
  "shared-identifier",
  "normalized-text-hash",
  "normalized-text-similarity",
]);

const proposalEndpointSchema = z
  .object({
    knowledgeNodeId: z.string().min(1),
    repositoryId: z.string().min(1),
    localNodeId: z.string().min(1),
  })
  .strict();

export const sharedNodeAliasSchema = z
  .object({
    scheme: nodeAliasSchemeSchema,
    value: z.string().min(1).max(500),
    sourceRoles: z.array(nodeAliasRoleSchema).min(1),
    targetRoles: z.array(nodeAliasRoleSchema).min(1),
  })
  .strict()
  .superRefine((alias, context) => {
    for (const [field, roles] of [
      ["sourceRoles", alias.sourceRoles],
      ["targetRoles", alias.targetRoles],
    ] as const) {
      if (roles.some((role) => schemeForRole(role) !== alias.scheme)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `All roles must belong to scheme '${alias.scheme}'.`,
        });
      }
      if (new Set(roles).size !== roles.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: "Alias roles must be unique.",
        });
      }
    }
  });
export type SharedNodeAlias = z.infer<typeof sharedNodeAliasSchema>;

export const nodeIdentityProposalSchema = z
  .object({
    proposalId: z.string().regex(/^nip_[0-9a-f]{64}$/),
    kind: nodeIdentityProposalKindSchema,
    source: proposalEndpointSchema,
    target: proposalEndpointSchema,
    signals: z.array(nodeIdentitySignalSchema).min(1),
    sharedAliases: z.array(sharedNodeAliasSchema).default([]),
    sourceTextHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    targetTextHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    textSimilarity: z.number().min(0).max(1).optional(),
    methodVersion: z.literal(NODE_IDENTITY_METHOD_VERSION),
  })
  .strict();
export type NodeIdentityProposal = z.infer<typeof nodeIdentityProposalSchema>;

export const nodeIdentityProposalReportSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    methodVersion: z.literal(NODE_IDENTITY_METHOD_VERSION),
    proposals: z.array(nodeIdentityProposalSchema),
    reportHash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type NodeIdentityProposalReport = z.infer<typeof nodeIdentityProposalReportSchema>;
