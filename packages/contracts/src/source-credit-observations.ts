import { z } from "zod";
import { creditRoleSchema } from "./editorial.js";

/**
 * PRIVATE, source-native observations only. NOT project authorization,
 * destination-confirmed CRediT, evidence of a new cross-project finding,
 * or a public publication payload. See ORAtlas #209 / #202.
 */
export const SOURCE_CREDIT_OBSERVATIONS_VERSION =
  "oratlas.source-credit-observations/0.1.0" as const;

export const sourceCreditProducerSchema = z.enum([
  "diggypaper",
  "computational-review-template",
  "orcid-playground",
]);

const bounded = z.string().min(1).max(500);
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);

export const sourceCreditTargetSchema = z
  .object({
    kind: z.enum(["source-finding", "review", "review-claim", "roster-output"]),
    sourceId: bounded,
    sourceVersion: bounded.nullable(),
    /** Binding is source-native; it does not supply an ORAtlas project grant. */
    bindingSha256: digest.nullable(),
    packetId: bounded.nullable(),
    packetManifestSha256: digest.nullable(),
    lineageSha256: digest.nullable(),
  })
  .strict();
export type SourceCreditTarget = z.infer<typeof sourceCreditTargetSchema>;

export const sourceCreditPersonSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("named"),
      sourcePersonId: bounded,
      displayName: bounded,
      orcid: z.string().nullable(),
      /** External assertion only: ORAtlas has not verified account ownership. */
      sourceOrcidStatus: z.enum(["source-verified", "claimed", "absent"]),
      verificationRef: bounded.nullable(),
    })
    .strict(),
  z.object({ kind: z.literal("pseudonym"), sourceRef: bounded }).strict(),
  z.object({ kind: z.literal("withheld") }).strict(),
]);
export type SourceCreditPerson = z.infer<typeof sourceCreditPersonSchema>;

export const sourceCreditRoleSchema = z
  .object({
    slug: creditRoleSchema,
    originalLabel: bounded,
    degree: z.enum(["lead", "equal", "supporting"]).nullable(),
    declarationRef: bounded.nullable(),
  })
  .strict();

export const sourceCreditAssertionSchema = z
  .object({
    observationId: bounded,
    target: sourceCreditTargetSchema,
    person: sourceCreditPersonSchema,
    capacity: bounded,
    role: sourceCreditRoleSchema.nullable(),
    /** Never interpreted as local ORAtlas confirmation. */
    sourceStatus: bounded,
    sourceDecisionRef: bounded.nullable(),
    destinationStatus: z.literal("not-adjudicated"),
    sourceAudience: bounded,
    /** Conservative; even a source-public decision cannot grant ORAtlas release. */
    oratlasDisclosure: z.literal("not-authorized"),
    disclosureBasis: z.array(bounded).max(12),
    assessmentIds: z.array(bounded).max(200),
  })
  .strict();
export type SourceCreditAssertion = z.infer<typeof sourceCreditAssertionSchema>;

export const sourceCreditEvidenceSchema = z
  .object({
    observationId: bounded,
    target: sourceCreditTargetSchema,
    sourcePaperId: bounded.nullable(),
    citedWorkDoi: bounded.nullable(),
    /** Originating context is source-declared, never a destination project grant. */
    nativeOriginId: bounded,
    nativeVisibility: bounded,
    sourceRights: bounded,
    sourceSnapshotSha256: digest.nullable(),
    phase2FindingSha256: digest.nullable(),
    passageIds: z.array(bounded).max(500),
    quoteSha256: z.array(digest).max(500),
    assessmentIds: z.array(bounded).max(500),
    /** Citation metadata, never review coauthorship. */
    originalPaperAuthors: z.array(bounded).max(500),
    sourceStatus: bounded,
    oratlasAdjudication: z.literal("none"),
  })
  .strict();

export const sourceCreditProductionSchema = z
  .object({
    observationId: bounded,
    target: sourceCreditTargetSchema,
    softwareName: bounded,
    softwareVersion: bounded.nullable(),
    runId: bounded.nullable(),
    activity: bounded,
    /** Tools never gain human CRediT credit or an ORCID subject. */
    actorKind: z.literal("software"),
  })
  .strict();

export const sourceCreditCandidateSchema = z
  .object({
    observationId: bounded,
    sourceMemberRef: bounded,
    sourceOutputRef: bounded.nullable(),
    orcid: z.string().nullable(),
    sourceRole: bounded.nullable(),
    role: sourceCreditRoleSchema.nullable(),
    sourceStatus: bounded,
    destinationStatus: z.literal("candidate-only"),
    accessEffect: z.literal("none"),
  })
  .strict();

export const sourceCreditReportSchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    withheld: z.number().int().nonnegative(),
    unmappable: z.number().int().nonnegative(),
    /** Stable codes only: no private names, project metadata or source excerpts. */
    reasonCodes: z.array(bounded),
  })
  .strict();

export const sourceCreditObservationsSchema = z
  .object({
    schemaVersion: z.literal(SOURCE_CREDIT_OBSERVATIONS_VERSION),
    producer: sourceCreditProducerSchema,
    producerContract: bounded,
    producerCommit: z.string().regex(/^[0-9a-f]{40}$/u),
    sourceId: bounded,
    /** Exact bytes of the source companion/roster, not the packet or claim graph. */
    sourceDocumentSha256: digest,
    visibility: z.literal("private-adapter-output"),
    accessEffect: z.literal("none"),
    accountVerification: z.literal("not-performed"),
    assertions: z.array(sourceCreditAssertionSchema).max(10000),
    evidence: z.array(sourceCreditEvidenceSchema).max(10000),
    production: z.array(sourceCreditProductionSchema).max(10000),
    candidateContacts: z.array(sourceCreditCandidateSchema).max(10000),
    report: sourceCreditReportSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const ids = [
      ...value.assertions.map((v) => v.observationId),
      ...value.evidence.map((v) => v.observationId),
      ...value.production.map((v) => v.observationId),
      ...value.candidateContacts.map((v) => v.observationId),
    ];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assertions"],
        message: "Observation ids must be distinct across all channels.",
      });
    }
    if (
      value.report.accepted !==
      value.assertions.length +
        value.evidence.length +
        value.production.length +
        value.candidateContacts.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["report", "accepted"],
        message: "Accepted count must equal the number of emitted observations.",
      });
    }
  });
export type SourceCreditObservations = z.infer<typeof sourceCreditObservationsSchema>;
