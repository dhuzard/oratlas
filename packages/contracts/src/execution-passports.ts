import { z } from "zod";
import { canonicalJson } from "./canonical-json.js";
import { commitShaSchema, httpsUrlSchema } from "./identifiers.js";

export const EXECUTION_ATTESTATION_PAYLOAD_TYPE =
  "application/vnd.oratlas.execution-attestation.v1+json";
export const EXECUTION_ATTESTED_STATUS = "execution-attested" as const;
export const RO_CRATE_1_1_CONTEXT = "https://w3id.org/ro/crate/1.1/context";
export const RO_CRATE_1_1_PROFILE = "https://w3id.org/ro/crate/1.1";
export const WORKFLOW_RUN_CONTEXT = "https://w3id.org/ro/terms/workflow-run/context";
export const WORKFLOW_RUN_PROFILE = "https://w3id.org/ro/wfrun/workflow/0.5";
export const PROCESS_RUN_PROFILE = "https://w3id.org/ro/wfrun/process/0.5";
export const WORKFLOW_RO_PROFILE = "https://w3id.org/workflowhub/workflow-ro-crate/1.0";

export const sha256DigestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "Must be a lowercase SHA-256 digest.");

const boundedIdSchema = z.string().trim().min(1).max(500);
const executionPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .refine(
    (path) =>
      !path.startsWith("/") &&
      !path.startsWith("~") &&
      !path.includes("\\") &&
      !path.includes(":") &&
      ![...path].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      }) &&
      path
        .split("/")
        .every(
          (segment) =>
            segment !== "" &&
            segment !== "." &&
            segment !== ".." &&
            /^[A-Za-z0-9._-]+$/.test(segment),
        ),
    "Must be a safe relative artifact path.",
  );
const entityReferenceSchema = z.object({ "@id": boundedIdSchema }).strict();
const entityReferenceListSchema = z
  .union([entityReferenceSchema, z.array(entityReferenceSchema).min(1).max(128)])
  .optional();

/**
 * A bounded JSON-LD entity contract for the Workflow Run RO-Crate subset that
 * Atlas ingests. Profile semantics are checked by @oratlas/execution-passports;
 * this transport schema deliberately retains extension fields for export.
 */
export const workflowRunCrateEntitySchema = z
  .object({
    "@id": boundedIdSchema,
    "@type": z.union([boundedIdSchema, z.array(boundedIdSchema).min(1).max(16)]),
    name: z.string().trim().min(1).max(500).optional(),
    about: entityReferenceSchema.optional(),
    conformsTo: entityReferenceListSchema,
    hasPart: entityReferenceListSchema,
    mainEntity: entityReferenceSchema.optional(),
    mentions: entityReferenceListSchema,
    programmingLanguage: entityReferenceSchema.optional(),
    license: z.union([boundedIdSchema, entityReferenceSchema]).optional(),
    instrument: entityReferenceSchema.optional(),
    object: entityReferenceListSchema,
    result: entityReferenceListSchema,
    claimBindings: entityReferenceListSchema,
    actionStatus: boundedIdSchema.optional(),
    codeRepository: httpsUrlSchema.optional(),
    commitSha: commitShaSchema.optional(),
    treeSha: commitShaSchema.optional(),
    workflowPath: executionPathSchema.optional(),
    runId: z.string().trim().min(1).max(200).optional(),
    runAttempt: z.number().int().positive().max(10_000).optional(),
    sha256: sha256DigestSchema.optional(),
    contentSize: z.number().int().nonnegative().max(50_000_000).optional(),
    encodingFormat: z.string().trim().min(1).max(200).optional(),
    oratlasClaimId: z.string().trim().min(1).max(1_000).optional(),
  })
  .passthrough();

export const workflowRunCrateSchema = z
  .object({
    "@context": z
      .array(z.union([z.literal(RO_CRATE_1_1_CONTEXT), z.literal(WORKFLOW_RUN_CONTEXT)]))
      .length(2),
    "@graph": z.array(workflowRunCrateEntitySchema).min(6).max(256),
  })
  .strict()
  .superRefine((crate, ctx) => {
    const contexts = crate["@context"];
    for (const required of [RO_CRATE_1_1_CONTEXT, WORKFLOW_RUN_CONTEXT] as const) {
      if (!contexts.includes(required)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["@context"],
          message: `Workflow Run crate must declare context ${required}.`,
        });
      }
    }
    const serialized = canonicalJson(crate);
    if (new TextEncoder().encode(serialized).byteLength > 160_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Workflow Run crate exceeds 160 KB." });
    }
    const ids = new Set<string>();
    for (const [index, entity] of crate["@graph"].entries()) {
      if (ids.has(entity["@id"])) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["@graph", index, "@id"],
          message: "Entity @id values must be unique.",
        });
      }
      ids.add(entity["@id"]);
    }
  });
export type WorkflowRunCrate = z.infer<typeof workflowRunCrateSchema>;

export const executionClaimBindingSchema = z
  .object({
    versionId: z.string().trim().min(1).max(200),
    localClaimId: z.string().trim().min(1).max(120),
    claimId: z.string().trim().min(1).max(1_000),
  })
  .strict();
export type ExecutionClaimBinding = z.infer<typeof executionClaimBindingSchema>;

export const executionArtifactDescriptorSchema = z
  .object({
    entityId: boundedIdSchema,
    role: z.enum(["input", "output"]),
    name: z.string().trim().min(1).max(500),
    path: executionPathSchema,
    mediaType: z.string().trim().min(1).max(200).optional(),
    byteSize: z.number().int().nonnegative().max(50_000_000),
    sha256: sha256DigestSchema,
  })
  .strict();
export type ExecutionArtifactDescriptor = z.infer<typeof executionArtifactDescriptorSchema>;

export const executionAttestationStatementSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    predicateType: z.literal("https://oratlas.org/attestations/execution/v1"),
    crateSha256: sha256DigestSchema,
    repository: z
      .object({
        url: httpsUrlSchema,
        commitSha: commitShaSchema,
        treeSha: commitShaSchema,
      })
      .strict(),
    workflow: z
      .object({
        entityId: boundedIdSchema,
        path: executionPathSchema,
        sha256: sha256DigestSchema,
        runId: z.string().trim().min(1).max(200),
        runAttempt: z.number().int().positive().max(10_000),
      })
      .strict(),
    claims: z.array(executionClaimBindingSchema).min(1).max(64),
    artifacts: z.array(executionArtifactDescriptorSchema).min(1).max(128),
    signingIdentity: z
      .object({
        issuer: z.string().trim().min(1).max(500),
        subject: z.string().trim().min(1).max(1_000),
      })
      .strict(),
    issuedAt: z.string().datetime(),
  })
  .strict();
export type ExecutionAttestationStatement = z.infer<typeof executionAttestationStatementSchema>;

const canonicalBase64Schema = z
  .string()
  .min(4)
  .max(220_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/, {
    message: "Must be canonical padded base64.",
  });

export const dsseEnvelopeSchema = z
  .object({
    payloadType: z.literal(EXECUTION_ATTESTATION_PAYLOAD_TYPE),
    payload: canonicalBase64Schema,
    signatures: z
      .array(
        z
          .object({
            keyId: sha256DigestSchema,
            sig: canonicalBase64Schema.max(2_000),
          })
          .strict(),
      )
      .min(1)
      .max(4),
  })
  .strict();
export type DsseEnvelope = z.infer<typeof dsseEnvelopeSchema>;

export const executionPassportRegistrationSchema = z
  .object({
    crate: workflowRunCrateSchema,
    attestation: dsseEnvelopeSchema,
  })
  .strict();
export type ExecutionPassportRegistration = z.infer<typeof executionPassportRegistrationSchema>;

export const executionPassportReverificationSchema = z
  .object({ expectedRevision: z.number().int().nonnegative() })
  .strict();
export type ExecutionPassportReverification = z.infer<typeof executionPassportReverificationSchema>;
