import { createHash } from "node:crypto";
import { z } from "zod";
import {
  RESEARCH_PROJECT_DESCRIPTOR_V2_VERSION,
  RESEARCH_PROJECT_DESCRIPTOR_VERSION,
  connectorProjectDescriptorSchema,
  researchArtifactKindSchema,
  researchProjectDescriptorSchema,
  researchGithubRepositorySchema,
  safeRepoRelativePathSchema,
  type ConnectorProjectDescriptor,
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
      | "source-oversize"
      | "source-invalid"
      | "source-digest-mismatch"
      | "source-incompatible"
      | "source-expired"
      | "source-audience-mismatch"
      | "packet-digest-mismatch",
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

/** dhuzard/diggypaper commit holding the captured connector exchange (Diggypaper #53, PR #74). */
export const DIGGYPAPER_PROJECT_DESCRIPTOR_PIN = "ea84932a248275feaaef051ca64c10cbed1d62dd";
/** The only audience ORAtlas accepts: a descriptor issued to another recipient is not ours. */
export const DIGGYPAPER_RECIPIENT = "recipient:oratlas";
const utc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u);
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const projectLink = z.string().regex(/^\/projects\/[0-9a-f-]{36}(?:\/[a-z0-9-]+)*$/u);
const metadataField = z.discriminatedUnion("state", [
  z.object({ state: z.literal("withheld") }).strict(),
  z
    .object({
      state: z.literal("disclosed"),
      value: z.string().min(1).max(2000),
      decision_ref: z.string().regex(/^decision:[0-9a-f]{32}$/u),
    })
    .strict(),
]);
/** research-project-descriptor/0.1.0, narrowed to a live connector issue (no synthetic fixture). */
const diggypaperNativeSchema = z
  .object({
    schema_version: z.literal("research-project-descriptor/0.1.0"),
    scope: z.literal("private-descriptor"),
    access_effect: z.literal("none"),
    creation_method: z.literal("producer-export"),
    issued_at: utc,
    expires_at: utc,
    audience: z
      .object({
        grant_ref: z.string().regex(/^grant:[0-9a-f]{32}$/u),
        recipient_ref: z.string().regex(/^recipient:[a-z0-9][a-z0-9-]{0,62}$/u),
      })
      .strict(),
    holder: z
      .object({ membership: z.literal("active"), role: z.enum(["lead", "annotator"]) })
      .strict(),
    policy: z
      .object({
        cross_project_processing: z.literal("not-authorized"),
        external_model_processing: z.literal("not-authorized"),
        full_text: z.literal("not-included"),
        publication: z.literal("not-released"),
      })
      .strict(),
    producer: z
      .object({
        name: z.literal("diggypaper"),
        commit: z
          .string()
          .length(40)
          .regex(/^[a-f0-9]{40}$/u),
      })
      .strict(),
    project: z
      .object({
        project_id: uuid,
        deep_link: projectLink,
        visibility: z.literal("private"),
        title: metadataField,
        description: metadataField,
      })
      .strict(),
    artifacts: z
      .array(
        z
          .object({
            type: z.literal("source-evidence-packet"),
            schema_version: z.literal("source-evidence-packet/0.1.0"),
            packet_id: z.string().regex(/^packet:[A-Za-z0-9._-]{1,100}$/u),
            digest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
            access_level: z.enum(["public", "restricted", "private", "embargoed"]),
            retrieval: z.literal("authorized-export-required"),
            deep_link: projectLink,
          })
          .strict(),
      )
      .max(100),
  })
  .strict();

const packetManifestSchema = z.object({
  artifacts: z.record(
    z.string(),
    z.object({ path: safeRepoRelativePathSchema, sha256: z.string(), bytes: z.number() }),
  ),
});

function sha256Of(raw: Uint8Array): string {
  return "sha256:" + createHash("sha256").update(raw).digest("hex");
}

/** True only if the manifest bytes match the digest and every file it lists matches too. */
function heldPacketMatches(digest: string, files: Readonly<Record<string, Uint8Array>>): boolean {
  const manifestBytes = files["manifest.json"];
  if (!(manifestBytes instanceof Uint8Array) || sha256Of(manifestBytes) !== digest) return false;
  let manifest: z.infer<typeof packetManifestSchema>;
  try {
    const parsed = packetManifestSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)),
    );
    if (!parsed.success) return false;
    manifest = parsed.data;
  } catch {
    return false;
  }
  const listed = Object.values(manifest.artifacts);
  return (
    listed.length > 0 &&
    listed.every((entry) => {
      const content = files[entry.path];
      return (
        content instanceof Uint8Array &&
        content.byteLength === entry.bytes &&
        sha256Of(content) === entry.sha256
      );
    })
  );
}

export type HeldPackets = Readonly<Record<string, Readonly<Record<string, Uint8Array>>>>;

/**
 * Offline observation of a captured Diggypaper connector descriptor. The digest binds held
 * bytes, not their source authority; no fetch, grant check, database, cache or public output.
 * Expired descriptors and descriptors issued to another recipient are refused (Diggypaper
 * contract section 5). A held packet whose bytes do not match its listed digest is refused;
 * matching bytes are recorded as such, never as scientific or rights validation.
 */
export function adaptDiggypaperProjectDescriptor(
  raw: Uint8Array,
  expectedSha256: string,
  options: { asOf: string; heldPackets?: HeldPackets },
): ConnectorProjectDescriptor {
  if (!(raw instanceof Uint8Array)) throw new ResearchProjectDescriptorError("source-invalid");
  if (raw.byteLength > MAX_PROJECT_DESCRIPTOR_BYTES)
    throw new ResearchProjectDescriptorError("source-oversize");
  const sourceDigest = sha256Of(raw);
  if (
    typeof expectedSha256 !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(expectedSha256) ||
    sourceDigest !== expectedSha256
  ) {
    throw new ResearchProjectDescriptorError("source-digest-mismatch");
  }
  if (!utc.safeParse(options?.asOf).success)
    throw new ResearchProjectDescriptorError("source-invalid");
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw new ResearchProjectDescriptorError("source-invalid");
  }
  const parsed = diggypaperNativeSchema.safeParse(value);
  if (!parsed.success) throw new ResearchProjectDescriptorError("source-incompatible");
  const native = parsed.data;
  const own = "/projects/" + native.project.project_id;
  if (
    native.project.deep_link !== own ||
    native.artifacts.some((a) => a.deep_link !== own && !a.deep_link.startsWith(own + "/"))
  ) {
    throw new ResearchProjectDescriptorError("source-incompatible");
  }
  if (native.audience.recipient_ref !== DIGGYPAPER_RECIPIENT)
    throw new ResearchProjectDescriptorError("source-audience-mismatch");
  if (!(native.issued_at <= options.asOf && options.asOf < native.expires_at))
    throw new ResearchProjectDescriptorError("source-expired");
  const held = options.heldPackets ?? {};
  for (const digest of Object.keys(held)) {
    if (!native.artifacts.some((a) => a.digest === digest))
      throw new ResearchProjectDescriptorError("packet-digest-mismatch");
  }
  const artifacts = native.artifacts
    .map((artifact) => {
      const files = held[artifact.digest];
      if (files && !heldPacketMatches(artifact.digest, files))
        throw new ResearchProjectDescriptorError("packet-digest-mismatch");
      return {
        artifactId: artifact.packet_id,
        sha256: artifact.digest,
        kind: "evidence-packet" as const,
        producerSchemaVersion: artifact.schema_version,
        declaredVisibility: artifact.access_level,
        retrieval: artifact.retrieval,
        artifactByteVerification: files
          ? ("held-bytes-match-digest" as const)
          : ("not-performed" as const),
        crossProjectProcessing: "not-authorized" as const,
      };
    })
    .sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : 0));
  const allVerified =
    artifacts.length > 0 &&
    artifacts.every((a) => a.artifactByteVerification === "held-bytes-match-digest");
  const metadata = (field: z.infer<typeof metadataField>) =>
    field.state === "disclosed"
      ? { state: "disclosed" as const, value: field.value }
      : { state: "withheld" as const };
  const descriptor = connectorProjectDescriptorSchema.safeParse({
    schemaVersion: RESEARCH_PROJECT_DESCRIPTOR_V2_VERSION,
    producer: "diggypaper",
    origin: "captured-producer-output",
    producerContract: native.schema_version,
    producerContractPinnedCommit: DIGGYPAPER_PROJECT_DESCRIPTOR_PIN,
    sourceDocumentSha256: sourceDigest,
    visibility: "private-adapter-output",
    accessEffect: "none",
    principalAuthorization: "not-performed",
    sourceVersionVerification: "not-performed",
    project: {
      sourceProjectId: native.project.project_id,
      title: metadata(native.project.title),
      description: metadata(native.project.description),
    },
    source: {
      provider: "producer-connector",
      declaredProducerCommit: native.producer.commit,
      declaredVisibility: native.project.visibility,
      retrieval: "authorized-export-required",
    },
    declaredHolderRole: native.holder.role,
    validity: { issuedAt: native.issued_at, expiresAt: native.expires_at },
    artifacts,
    report: {
      reasonCodes: [
        "source-permission-not-verified",
        "source-version-not-verified",
        ...(allVerified ? [] : (["artifact-bytes-not-verified"] as const)),
        "processing-not-authorized",
        "publication-not-authorized",
      ],
    },
  });
  if (!descriptor.success) throw new ResearchProjectDescriptorError("source-incompatible");
  return descriptor.data;
}

/** Scoped identity of a connector artifact: producer, project, producer commit and digest. */
export function connectorArtifactIdentity(
  descriptor: ConnectorProjectDescriptor,
  artifactId: string,
): string {
  const validated = connectorProjectDescriptorSchema.safeParse(descriptor);
  if (!validated.success) throw new ResearchProjectDescriptorError("source-incompatible");
  const parsed = validated.data;
  const artifact = parsed.artifacts.find((item) => item.artifactId === artifactId);
  if (!artifact) throw new ResearchProjectDescriptorError("source-incompatible");
  return JSON.stringify([
    parsed.producer,
    parsed.project.sourceProjectId,
    parsed.source.provider,
    parsed.source.declaredProducerCommit,
    artifact.artifactId,
    artifact.sha256,
  ]);
}
