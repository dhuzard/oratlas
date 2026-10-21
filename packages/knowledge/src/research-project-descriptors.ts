import { createHash } from "node:crypto";
import { z } from "zod";
import {
  RESEARCH_PROJECT_DESCRIPTOR_VERSION,
  researchArtifactKindSchema,
  researchProjectDescriptorSchema,
  researchGithubRepositorySchema,
  safeRepoRelativePathSchema,
  type ResearchProjectDescriptor,
} from "@oratlas/contracts";

export const CRT_PROJECT_DESCRIPTOR_PIN = "3092657a59d27fa14ab2d777568b10e5e5c6a075";
export const MAX_PROJECT_DESCRIPTOR_BYTES = 1_000_000;
const text = z.string().min(1).max(500);
const hex = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/u);
const nativeSchema = z
  .object({
    protocol: z.literal("research-project-artifacts/0.1"),
    scope: z.literal("private-descriptor"),
    access_effect: z.literal("none"),
    project: z.object({ id: text, research_question: z.string().min(1).max(5000) }).strict(),
    source: z
      .object({
        provider: z.literal("github"),
        repository: researchGithubRepositorySchema,
        commit: z
          .string()
          .length(40)
          .regex(/^[a-f0-9]{40}$/u),
        visibility: z.enum(["private", "public"]),
      })
      .strict(),
    workflow: z.object({ phase: text, run_id: text }).strict(),
    artifacts: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^[a-z][a-z0-9-]*(?![\s\S])/u)
              .max(500),
            path: safeRepoRelativePathSchema,
            sha256: hex,
            bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
            kind: researchArtifactKindSchema.extract([
              "reading-corpus",
              "literature-packet",
              "working-draft",
              "claim-graph",
              "contributorship",
              "human-decisions",
              "provenance",
              "reviewed-release",
            ]),
            state: z.enum(["working", "reviewed", "released"]),
            visibility: z.enum(["private", "restricted", "public"]),
            rights: z
              .object({
                license: text,
                redistribution: z.enum(["allowed", "prohibited", "unknown"]),
              })
              .strict(),
            clearance: z.literal("current"),
            generator: z
              .object({ name: text, version: text, role: text, run_id: text })
              .strict()
              .nullable(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();

export class ResearchProjectDescriptorError extends Error {
  constructor(
    readonly code:
      "source-oversize" | "source-invalid" | "source-digest-mismatch" | "source-incompatible",
  ) {
    super(code);
    this.name = "ResearchProjectDescriptorError";
  }
}

/**
 * Offline observation only. The digest binds held bytes, not their source authority.
 * No fetch, source loading, principal grant, database, cache or public projection.
 * Missing native processing/grant information narrows to NOT authorized.
 */
export function adaptCRTProjectDescriptor(
  raw: Uint8Array,
  expectedSha256: string,
): ResearchProjectDescriptor {
  if (!(raw instanceof Uint8Array)) throw new ResearchProjectDescriptorError("source-invalid");
  if (raw.byteLength > MAX_PROJECT_DESCRIPTOR_BYTES)
    throw new ResearchProjectDescriptorError("source-oversize");
  const sourceDigest = "sha256:" + createHash("sha256").update(raw).digest("hex");
  if (
    typeof expectedSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(expectedSha256) ||
    sourceDigest !== expectedSha256
  ) {
    throw new ResearchProjectDescriptorError("source-digest-mismatch");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new ResearchProjectDescriptorError("source-invalid");
  }
  const parsed = nativeSchema.safeParse(value);
  if (!parsed.success) throw new ResearchProjectDescriptorError("source-incompatible");
  const native = parsed.data;
  const artifacts = native.artifacts
    .map((artifact) => ({
      artifactId: artifact.id,
      path: artifact.path,
      sha256: "sha256:" + artifact.sha256,
      byteLength: artifact.bytes,
      kind: artifact.kind,
      declaredState: artifact.state,
      declaredVisibility: artifact.visibility,
      rights: artifact.rights,
      clearance: artifact.clearance,
      artifactByteVerification: "not-performed" as const,
      crossProjectProcessing: "not-authorized" as const,
      generator: artifact.generator
        ? {
            name: artifact.generator.name,
            version: artifact.generator.version,
            role: artifact.generator.role,
            runId: artifact.generator.run_id,
          }
        : null,
    }))
    .sort((a, b) => (a.artifactId < b.artifactId ? -1 : a.artifactId > b.artifactId ? 1 : 0));
  const descriptor = researchProjectDescriptorSchema.safeParse({
    schemaVersion: RESEARCH_PROJECT_DESCRIPTOR_VERSION,
    producer: "computational-review-template",
    origin: "captured-producer-output",
    producerContract: native.protocol,
    producerContractPinnedCommit: CRT_PROJECT_DESCRIPTOR_PIN,
    sourceDocumentSha256: sourceDigest,
    visibility: "private-adapter-output",
    accessEffect: "none",
    principalAuthorization: "not-performed",
    sourceVersionVerification: "not-performed",
    project: {
      sourceProjectId: native.project.id,
      researchQuestion: native.project.research_question,
    },
    source: {
      provider: native.source.provider,
      repository: native.source.repository,
      declaredCommit: native.source.commit,
      declaredVisibility: native.source.visibility,
    },
    workflow: { phase: native.workflow.phase, runId: native.workflow.run_id },
    artifacts,
    creditArtifactIds: artifacts
      .filter((artifact) => artifact.kind === "contributorship")
      .map((artifact) => artifact.artifactId),
    report: {
      reasonCodes: [
        "source-permission-not-verified",
        "source-version-not-verified",
        "artifact-bytes-not-verified",
        "processing-not-authorized",
        "publication-not-authorized",
      ],
    },
  });
  if (!descriptor.success) throw new ResearchProjectDescriptorError("source-incompatible");
  return descriptor.data;
}

/** Scoped identity never collapses an artifact by DOI, text, or local id alone. */
export function researchArtifactIdentity(
  descriptor: ResearchProjectDescriptor,
  artifactId: string,
): string {
  const validated = researchProjectDescriptorSchema.safeParse(descriptor);
  if (!validated.success) throw new ResearchProjectDescriptorError("source-incompatible");
  const parsed = validated.data;
  const artifact = parsed.artifacts.find((item) => item.artifactId === artifactId);
  if (!artifact) throw new ResearchProjectDescriptorError("source-incompatible");
  return JSON.stringify([
    parsed.producer,
    parsed.project.sourceProjectId,
    parsed.source.repository,
    parsed.source.declaredCommit,
    artifact.artifactId,
    artifact.path,
    artifact.sha256,
  ]);
}
