import { z } from "zod";
import { safeRepoRelativePathSchema } from "./paths.js";
import { githubOwnerSchema, githubRepoNameSchema } from "./identifiers.js";

/** Source declarations, not a principal grant or a public publication payload (#206). */
export const RESEARCH_PROJECT_DESCRIPTOR_VERSION =
  "oratlas.research-project-descriptor-observations/0.1.0" as const;

const identifier = z.string().min(1).max(500);
const sha256 = z
  .string()
  .length(71)
  .regex(/^sha256:[a-f0-9]{64}$/u);
const commit = z
  .string()
  .length(40)
  .regex(/^[a-f0-9]{40}$/u);
export const researchGithubRepositorySchema = z
  .string()
  .min(3)
  .max(140)
  .refine((value) => {
    const parts = value.split("/");
    return (
      parts.length === 2 &&
      githubOwnerSchema.safeParse(parts[0]).success &&
      githubRepoNameSchema.safeParse(parts[1]).success
    );
  }, "Invalid GitHub repository coordinate.");
export const researchArtifactKindSchema = z.enum([
  "reading-corpus",
  "literature-packet",
  "working-draft",
  "claim-graph",
  "contributorship",
  "human-decisions",
  "provenance",
  "reviewed-release",
  "source-finding",
  "evidence-packet",
  "analysis",
  "data-code",
  "agent-run",
]);

export const researchArtifactReferenceSchema = z
  .object({
    artifactId: identifier,
    path: safeRepoRelativePathSchema,
    sha256,
    byteLength: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    kind: researchArtifactKindSchema,
    declaredState: z.enum(["working", "reviewed", "released"]),
    declaredVisibility: z.enum(["private", "restricted", "public"]),
    rights: z
      .object({ license: identifier, redistribution: z.enum(["allowed", "prohibited", "unknown"]) })
      .strict(),
    clearance: z.literal("current"),
    artifactByteVerification: z.literal("not-performed"),
    /** No processing policy is supplied by the current CRT producer contract. */
    crossProjectProcessing: z.literal("not-authorized"),
    generator: z
      .object({ name: identifier, version: identifier, role: identifier, runId: identifier })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.declaredVisibility === "public" &&
        (value.declaredState !== "released" || value.rights.redistribution !== "allowed")) ||
      (value.kind === "reviewed-release" && value.declaredState !== "released")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Inconsistent declared release rights.",
      });
    }
  });
export type ResearchArtifactReference = z.infer<typeof researchArtifactReferenceSchema>;

export const researchProjectDescriptorSchema = z
  .object({
    schemaVersion: z.literal(RESEARCH_PROJECT_DESCRIPTOR_VERSION),
    producer: z.enum(["diggypaper", "computational-review-template"]),
    origin: z.enum(["captured-producer-output", "synthetic-neutral-fixture"]),
    producerContract: identifier,
    producerContractPinnedCommit: commit.nullable(),
    sourceDocumentSha256: sha256,
    visibility: z.literal("private-adapter-output"),
    accessEffect: z.literal("none"),
    principalAuthorization: z.literal("not-performed"),
    sourceVersionVerification: z.literal("not-performed"),
    project: z
      .object({ sourceProjectId: identifier, researchQuestion: z.string().min(1).max(5000) })
      .strict(),
    source: z
      .object({
        provider: z.literal("github"),
        repository: researchGithubRepositorySchema,
        declaredCommit: commit,
        declaredVisibility: z.enum(["private", "public"]),
      })
      .strict(),
    workflow: z.object({ phase: identifier, runId: identifier }).strict(),
    artifacts: z.array(researchArtifactReferenceSchema).min(1).max(1000),
    /** Exact references only; identities and native scientific assessments are never flattened. */
    creditArtifactIds: z.array(identifier).max(1000),
    report: z
      .object({
        reasonCodes: z
          .array(
            z.enum([
              "source-permission-not-verified",
              "source-version-not-verified",
              "artifact-bytes-not-verified",
              "processing-not-authorized",
              "publication-not-authorized",
            ]),
          )
          .min(1)
          .max(5),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.origin === "captured-producer-output") !==
      (value.producerContractPinnedCommit !== null)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Producer capture pin or synthetic origin missing.",
      });
    }
    const ids = value.artifacts.map((artifact) => artifact.artifactId);
    const paths = value.artifacts.map((artifact) => artifact.path);
    const credit = value.artifacts
      .filter((artifact) => artifact.kind === "contributorship")
      .map((artifact) => artifact.artifactId)
      .sort();
    if (
      new Set(ids).size !== ids.length ||
      new Set(paths).size !== paths.length ||
      JSON.stringify([...value.creditArtifactIds].sort()) !== JSON.stringify(credit)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Ambiguous artifact identity or credit references.",
      });
    }
  });
export type ResearchProjectDescriptor = z.infer<typeof researchProjectDescriptorSchema>;
