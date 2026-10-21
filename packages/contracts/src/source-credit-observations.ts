import { z } from "zod";
import { creditRoleSchema } from "./editorial.js";
import { isChecksumValidOrcid } from "./identifiers.js";

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
    sourceContractPinnedCommit: z.string().regex(/^[0-9a-f]{40}$/u),
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

// ---------------------------------------------------------------------------
// oratlas.source-credit-observations/0.2.0
//
// Additive, explicitly versioned successor. 0.1.0 above is kept byte-for-byte
// as a legacy contract; nothing parses one version with the other's schema
// (the `schemaVersion` literal rejects it). 0.2.0 preserves the structured
// source facts that 0.1.0 flattened or dropped (see docs/source-credit-interop.md).
// It is still PRIVATE adapter output: no authorization, no destination
// confirmation, no science verification, no authorship.
// ---------------------------------------------------------------------------

export const SOURCE_CREDIT_OBSERVATIONS_V2_VERSION =
  "oratlas.source-credit-observations/0.2.0" as const;

/** Exact frozen producer contract and merged commit per producer. */
export const SOURCE_CREDIT_PRODUCER_PINS = {
  diggypaper: {
    contract: "finding-credit-companion/0.1.0",
    commit: "a34d18f752377b2a6df01555d1963b2a43c0dca9",
    idPrefix: "diggypaper:",
  },
  "computational-review-template": {
    contract: "comprev.contributorship/1",
    commit: "a19a8dc90ddbf93c06d6ab050aaad3a00d28a262",
    idPrefix: "crt:",
  },
  "orcid-playground": {
    contract: "orcid-playground/roster-assertion/0.1.0",
    commit: "ff5aff93cb34620f3f2500f709259aa0134c24f2",
    idPrefix: "orcid:",
  },
} as const satisfies Record<
  z.infer<typeof sourceCreditProducerSchema>,
  { contract: string; commit: string; idPrefix: string }
>;

/** The reserved Crossref test prefix; such DOIs are never outbound links. */
export const isExampleDoi = (doi: string): boolean => doi.toLowerCase().startsWith("10.5555/");

const code = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9.-]*$/u);
const orcidId = z.string().refine(isChecksumValidOrcid, "ORCID iD format or checksum invalid.");
const count = z.number().int().nonnegative();
const sortedUnique = (values: readonly string[]): boolean =>
  values.every((value, index) => index === 0 || values[index - 1]! < value);

/** Source-native ORCID assertion. `source-verified` is the producer's claim, never ORAtlas's. */
export const sourceCreditOrcidV2Schema = z
  .object({
    id: orcidId,
    sourceStatus: z.enum(["source-verified", "claimed"]),
    nativeStatus: bounded,
    verificationMethod: bounded.nullable(),
    verificationRef: bounded.nullable(),
    verifiedAt: bounded.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const proof = [value.verificationRef, value.verifiedAt];
    if (value.sourceStatus === "source-verified" ? proof.includes(null) : proof.some(Boolean)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["verificationRef"],
        message: "Source verification status and its evidence must agree.",
      });
    }
  });

export const sourceCreditPersonV2Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("named"),
      /** Native person id (CRT contributor id); null when the source has none (Diggypaper). */
      sourcePersonId: bounded.nullable(),
      legacySourcePersonId: bounded.nullable(),
      displayName: bounded,
      orcid: sourceCreditOrcidV2Schema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("pseudonym"),
      sourceRef: bounded,
      refKind: z.literal("source-native-pseudonym"),
    })
    .strict(),
  z.object({ kind: z.literal("withheld") }).strict(),
]);
export type SourceCreditPersonV2 = z.infer<typeof sourceCreditPersonV2Schema>;

export const sourceCreditRoleV2Schema = z
  .object({
    slug: creditRoleSchema,
    originalLabel: bounded,
    degree: z.enum(["lead", "equal", "supporting"]).nullable(),
    declarationRef: bounded.nullable(),
    roleUri: bounded.nullable(),
  })
  .strict();

const crtDisclosureFacts = z
  .object({
    public: z.boolean(),
    reason: bounded.nullable(),
    /** null = field absent in the source (distinct from an empty list). */
    approvedFields: z.array(bounded).max(3).nullable(),
    approvalIds: z.array(bounded).max(100),
  })
  .strict();

/** Source disclosure facts, verbatim. None of them is an ORAtlas release decision. */
export const sourceCreditDisclosureV2Schema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("diggypaper-contribution"),
      personConsent: bounded,
      controllerAuthorization: bounded,
      membership: bounded,
      consentRef: bounded.nullable(),
      reviewBlinding: bounded,
    })
    .strict(),
  crtDisclosureFacts.extend({ kind: z.literal("crt-contributor") }).strict(),
]);

export const sourceCreditAssertionV2Schema = z
  .object({
    observationId: bounded,
    target: sourceCreditTargetSchema,
    /** Native contribution / assertion id. Never a person identity. */
    sourceAssertionId: bounded,
    person: sourceCreditPersonV2Schema,
    capacity: bounded,
    role: sourceCreditRoleV2Schema.nullable(),
    sourceStatus: bounded,
    /** Diggypaper: disclosure.consent_ref; CRT: status_ref. Never synthesized. */
    sourceDecisionRef: bounded.nullable(),
    sourceDeclarationKind: bounded.nullable(),
    sourceAssertedAt: bounded.nullable(),
    sourceDisclosure: sourceCreditDisclosureV2Schema,
    sourceAudience: bounded,
    destinationStatus: z.literal("not-adjudicated"),
    oratlasDisclosure: z.literal("not-authorized"),
    assessmentIds: z.array(bounded).max(500),
  })
  .strict();
export type SourceCreditAssertionV2 = z.infer<typeof sourceCreditAssertionV2Schema>;

export const sourceCreditEvidenceV2Schema = z
  .object({
    observationId: bounded,
    target: sourceCreditTargetSchema,
    nativeBinding: z.enum(["diggypaper-credit-entry", "crt-reviewed-mapping"]),
    /** Native Diggypaper `entries[].entry_id`; null when the source has none (CRT). */
    sourceEntryId: bounded.nullable(),
    sourcePaperId: bounded.nullable(),
    findingOrigin: bounded.nullable(),
    sourceSnapshotRef: bounded.nullable(),
    sourceSnapshotSha256: digest.nullable(),
    phase2FindingSha256: digest.nullable(),
    /** Citation metadata: never support, independence, review coauthorship or credit. */
    citedWork: z
      .object({
        doi: bounded.nullable(),
        doiIsExample: z.boolean(),
        citeKey: bounded.nullable(),
        authors: z.array(bounded).max(500),
        authorsAre: z.literal("bibliographic-citation-metadata"),
      })
      .strict(),
    nativeOrigin: z
      .object({
        originId: bounded,
        visibility: bounded,
        disclosure: crtDisclosureFacts.nullable(),
      })
      .strict(),
    /** CRT mapping decision, kept structured (claim, decision, time, claim disclosure). */
    mapping: z
      .object({
        binding: z.literal("reviewed-mapping"),
        claimId: bounded,
        decisionRef: bounded,
        mappedAt: bounded,
        claimDisclosure: crtDisclosureFacts,
      })
      .strict()
      .nullable(),
    sourceRights: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("diggypaper-paper-rights"),
          license: bounded,
          redistribution: bounded,
          fullTextIncluded: z.boolean(),
          packetLicenses: z
            .array(z.object({ appliesTo: bounded, licenseId: bounded }).strict())
            .max(50),
        })
        .strict(),
      z
        .object({
          kind: z.literal("crt-passage-disclosure"),
          passageDisclosure: z.enum(["rights-allow", "rights-restricted"]),
        })
        .strict(),
    ]),
    passages: z
      .array(
        z
          .object({ passageId: bounded, quoteSha256: digest, quoteState: bounded.nullable() })
          .strict(),
      )
      .max(500),
    assessmentProtocol: bounded.nullable(),
    sourceAssessments: z
      .array(
        z
          .object({
            assessmentId: bounded,
            protocol: bounded,
            status: bounded.nullable(),
            /** Source-native curator pseudonym; never a review contributor or author. */
            curatorRef: z
              .object({ kind: z.literal("source-native-pseudonym"), ref: bounded })
              .strict()
              .nullable(),
            assessedSnapshotSha256: digest.nullable(),
          })
          .strict(),
      )
      .max(500),
    oratlasAdjudication: z.literal("none"),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.citedWork.doi !== null &&
      isExampleDoi(value.citedWork.doi) !== value.citedWork.doiIsExample
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["citedWork", "doiIsExample"],
        message: "Example-DOI flag must match the reserved 10.5555 prefix.",
      });
    }
  });

export const sourceCreditProductionV2Schema = z
  .object({
    observationId: bounded,
    target: sourceCreditTargetSchema,
    softwareName: bounded,
    softwareVersion: bounded.nullable(),
    softwareProducer: bounded.nullable(),
    /** Native agent type, e.g. Diggypaper `software` / `ml-model`, CRT `software-agent`. */
    agentType: bounded,
    /** Native agent id (CRT); it is not a run. */
    sourceAgentId: bounded.nullable(),
    /** Native run reference only when the source recorded one. */
    runRef: bounded.nullable(),
    activity: bounded.nullable(),
    legacyAuthorId: bounded.nullable(),
    creditChannel: z.literal("production"),
    actorKind: z.literal("software"),
  })
  .strict();

/** Source legacy role labels, verbatim. ORAtlas never maps them; the source mapping is a claim. */
export const sourceCreditLegacyRoleLabelSchema = z
  .object({
    observationId: bounded,
    target: sourceCreditTargetSchema,
    subject: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("person"), sourcePersonId: bounded }).strict(),
      z.object({ kind: z.literal("software-agent"), sourceAgentId: bounded }).strict(),
    ]),
    field: bounded,
    position: count,
    label: bounded.nullable(),
    level: bounded.nullable(),
    sourceMappedRole: creditRoleSchema.nullable(),
    sourceMapping: z.enum(["exact", "normalized", "unmappable"]),
    sourceCreditEligible: z.boolean(),
    sourceRef: bounded.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.subject.kind === "software-agent" && value.sourceCreditEligible) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceCreditEligible"],
        message: "Software agents are never CRediT-eligible.",
      });
    }
  });

export const rosterAssertionV2Schema = z
  .object({
    basis: z.enum(["public-orcid-record", "owner-curated", "external-verified"]),
    method: bounded,
    assertedAt: bounded,
    assertedBy: bounded.nullable(),
    evidence: z
      .object({ sourceRecordVersion: bounded.nullable(), reference: bounded.nullable() })
      .strict(),
  })
  .strict();

export const sourceCreditCandidateContactV2Schema = z
  .object({
    observationId: bounded,
    sourceMemberRef: bounded,
    displayName: bounded.nullable(),
    /** Free-text local group label: never a CRediT or access role. */
    localRole: bounded.nullable(),
    orcid: z
      .object({
        id: orcidId,
        uri: bounded,
        nativeStatus: z.enum(["claimed", "oauth-verified"]),
        assertion: rosterAssertionV2Schema,
      })
      .strict()
      .nullable(),
    membership: z.object({ nativeStatus: bounded, assertion: rosterAssertionV2Schema }).strict(),
    personAssertion: rosterAssertionV2Schema,
    destinationStatus: z.literal("candidate-only"),
    accessEffect: z.literal("none"),
  })
  .strict();

export const sourceCreditCandidateCreditClaimV2Schema = z
  .object({
    observationId: bounded,
    sourceMemberRef: bounded,
    output: z
      .object({
        sourceOutputRef: bounded,
        doi: bounded.nullable(),
        doiIsExample: z.boolean(),
        sourceRights: bounded,
        assertion: rosterAssertionV2Schema,
      })
      .strict(),
    role: sourceCreditRoleV2Schema.nullable(),
    sourceStatus: bounded,
    assertion: rosterAssertionV2Schema,
    destinationStatus: z.literal("candidate-only"),
    accessEffect: z.literal("none"),
    confirmedByImport: z.literal(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.output.doi !== null && isExampleDoi(value.output.doi) !== value.output.doiIsExample) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["output", "doiIsExample"],
        message: "Example-DOI flag must match the reserved 10.5555 prefix.",
      });
    }
  });

const diggypaperSourceDocument = z
  .object({
    kind: z.literal("diggypaper-companion"),
    companionId: bounded,
    createdAt: bounded,
    creationMethod: bounded,
    producer: z.object({ name: bounded, commit: bounded }).strict(),
    audience: z
      .object({ level: bounded, recipientRef: bounded.nullable(), expiresAt: bounded.nullable() })
      .strict(),
    release: z
      .object({ state: bounded, approvalRef: bounded.nullable(), approvedAt: bounded.nullable() })
      .strict(),
    creditSemantics: z
      .object({
        roleVocabulary: z.literal("CRediT ANSI/NISO Z39.104-2022"),
        impliesAuthorship: z.literal(false),
      })
      .strict(),
    exportStatus: z
      .object({
        state: z.enum(["complete", "partial", "withheld"]),
        withheldCounts: z.object({ entries: count, contributions: count }).strict(),
        reasons: z.array(bounded).max(200),
      })
      .strict(),
    packet: z
      .object({
        packetId: bounded,
        schemaVersion: z.literal("source-evidence-packet/0.1.0"),
        manifestSha256: digest,
        accessScopeLevel: bounded,
        producer: z.object({ name: bounded, commit: bounded }).strict(),
      })
      .strict(),
  })
  .strict();

const crtSourceDocument = z
  .object({
    kind: z.literal("crt-contributorship"),
    reviewId: bounded,
    version: bounded,
    claimGraphSha256: digest,
    claimGraphBytesVerified: z.boolean(),
    visibility: z.literal("private"),
    creditStandard: z.literal("ANSI/NISO Z39.104-2022"),
  })
  .strict();

const orcidSourceDocument = z
  .object({
    kind: z.literal("orcid-roster"),
    exportId: bounded,
    generatedAt: bounded,
    origin: z.enum(["local-offline-roster", "external-platform"]),
    distribution: z.literal("private-recipient-only"),
    sourceAccessEffect: z
      .object({
        grants: z.literal("none"),
        invitations: z.literal("none"),
        accounts: z.literal("none"),
        authorship: z.literal("not-implied"),
        credit: z.literal("not-inferred"),
      })
      .strict(),
    consent: z
      .object({
        status: z.enum(["granted", "revoked"]),
        scope: bounded,
        method: bounded,
        grantedAt: bounded,
        grantedBy: bounded,
        revokedAt: bounded.nullable(),
      })
      .strict(),
    redaction: z
      .object({
        policy: bounded,
        memberFields: z.array(z.enum(["display_name", "local_role", "orcid"])).max(3),
        privateMembers: z.literal("omitted"),
        excludedOutputs: z.array(bounded).max(10),
        projectReferences: z.enum(["omitted", "included"]),
      })
      .strict(),
    group: z.object({ localId: bounded, createdBy: bounded }).strict(),
    digest: z
      .object({ algorithm: z.literal("sha256"), value: z.string().regex(/^[0-9a-f]{64}$/u) })
      .strict(),
  })
  .strict();

export const sourceCreditReportV2Schema = z
  .object({
    /** Emitted observations across assertions/evidence/production/candidate channels. */
    accepted: count,
    /** Emitted records whose identity or origin the SOURCE marks withheld/non-public. */
    withheld: count,
    /** Unmapped roles (also accepted) plus non-authoritative source records not emitted. */
    unmappable: count,
    reasonCodes: z.array(code),
    /** Counted separately from `accepted`. */
    legacyRoleLabels: z
      .object({ preserved: count, sourceUnmappable: count, sourceCreditIneligible: count })
      .strict(),
    /** What the producer itself says it omitted, verbatim; never re-counted by ORAtlas. */
    producerDeclaredOmissions: z
      .object({
        state: bounded.nullable(),
        counts: z.record(code, count),
        reasons: z.array(bounded).max(200),
      })
      .strict()
      .nullable(),
    /** Source fields this adapter deliberately does not carry (stable codes). */
    omittedSourceFields: z.array(code),
  })
  .strict();

export const sourceCreditObservationsV2Schema = z
  .object({
    schemaVersion: z.literal(SOURCE_CREDIT_OBSERVATIONS_V2_VERSION),
    producer: sourceCreditProducerSchema,
    producerContract: bounded,
    sourceContractPinnedCommit: z.string().regex(/^[0-9a-f]{40}$/u),
    sourceId: bounded,
    sourceDocumentSha256: digest,
    visibility: z.literal("private-adapter-output"),
    accessEffect: z.literal("none"),
    accountVerification: z.literal("not-performed"),
    sourceDocument: z.discriminatedUnion("kind", [
      diggypaperSourceDocument,
      crtSourceDocument,
      orcidSourceDocument,
    ]),
    assertions: z.array(sourceCreditAssertionV2Schema).max(10000),
    evidence: z.array(sourceCreditEvidenceV2Schema).max(10000),
    production: z.array(sourceCreditProductionV2Schema).max(10000),
    sourceLegacyRoleLabels: z.array(sourceCreditLegacyRoleLabelSchema).max(10000),
    candidateContacts: z.array(sourceCreditCandidateContactV2Schema).max(10000),
    candidateCreditClaims: z.array(sourceCreditCandidateCreditClaimV2Schema).max(10000),
    report: sourceCreditReportV2Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: z.ZodIssueCode.custom, path, message });
    const pin = SOURCE_CREDIT_PRODUCER_PINS[value.producer];
    if (
      value.producerContract !== pin.contract ||
      value.sourceContractPinnedCommit !== pin.commit
    ) {
      issue(
        ["producerContract"],
        "Producer contract and pinned commit must match the producer pin.",
      );
    }
    const documentKind = {
      diggypaper: "diggypaper-companion",
      "computational-review-template": "crt-contributorship",
      "orcid-playground": "orcid-roster",
    }[value.producer];
    if (value.sourceDocument.kind !== documentKind) {
      issue(["sourceDocument", "kind"], "Source document provenance must match the producer.");
    }
    const channels = {
      assertions: value.assertions,
      evidence: value.evidence,
      production: value.production,
      sourceLegacyRoleLabels: value.sourceLegacyRoleLabels,
      candidateContacts: value.candidateContacts,
      candidateCreditClaims: value.candidateCreditClaims,
    };
    const roster = value.producer === "orcid-playground";
    for (const [name, records] of Object.entries(channels)) {
      const rosterChannel = name === "candidateContacts" || name === "candidateCreditClaims";
      if (records.length > 0 && rosterChannel !== roster) {
        issue([name], "Channel is not produced by this producer.");
      }
      if (
        name === "sourceLegacyRoleLabels" &&
        records.length > 0 &&
        value.producer !== "computational-review-template"
      ) {
        issue([name], "Only CRT records legacy role labels.");
      }
      const ids = records.map((record) => record.observationId);
      if (!sortedUnique(ids)) issue([name], "Observation ids must be unique and sorted.");
      if (ids.some((id) => !id.startsWith(pin.idPrefix))) {
        issue([name], "Observation ids must carry the producer prefix.");
      }
    }
    const allIds = Object.values(channels).flatMap((records) =>
      records.map((r) => r.observationId),
    );
    if (new Set(allIds).size !== allIds.length) {
      issue(["assertions"], "Observation ids must be distinct across all channels.");
    }
    const report = value.report;
    const accepted =
      value.assertions.length +
      value.evidence.length +
      value.production.length +
      value.candidateContacts.length +
      value.candidateCreditClaims.length;
    if (report.accepted !== accepted) {
      issue(["report", "accepted"], "Accepted count must equal the emitted observation channels.");
    }
    const withheldPersons = value.assertions.filter((a) => a.person.kind === "withheld").length;
    if (report.withheld < withheldPersons) {
      issue(["report", "withheld"], "Withheld count cannot be lower than withheld identities.");
    }
    const unmappedRoles = [...value.candidateCreditClaims].filter((c) => c.role === null).length;
    if (report.unmappable < unmappedRoles) {
      issue(["report", "unmappable"], "Unmappable count cannot be lower than unmapped roles.");
    }
    const labels = value.sourceLegacyRoleLabels;
    if (
      report.legacyRoleLabels.preserved !== labels.length ||
      report.legacyRoleLabels.sourceUnmappable !==
        labels.filter((l) => l.sourceMapping === "unmappable").length ||
      report.legacyRoleLabels.sourceCreditIneligible !==
        labels.filter((l) => !l.sourceCreditEligible).length
    ) {
      issue(["report", "legacyRoleLabels"], "Legacy label counts must match the preserved labels.");
    }
    if (!sortedUnique(report.reasonCodes) || !sortedUnique(report.omittedSourceFields)) {
      issue(["report"], "Report codes must be unique and sorted.");
    }
    if (value.sourceDocument.kind === "orcid-roster") {
      const fields = new Set(value.sourceDocument.redaction.memberFields);
      const local = value.sourceDocument.origin === "local-offline-roster";
      const members = new Set(value.candidateContacts.map((c) => c.sourceMemberRef));
      value.candidateContacts.forEach((contact, index) => {
        if (
          (contact.displayName !== null && !fields.has("display_name")) ||
          (contact.localRole !== null && !fields.has("local_role")) ||
          (contact.orcid !== null && !fields.has("orcid"))
        ) {
          issue(
            ["candidateContacts", index],
            "A member field outside redaction.memberFields is present.",
          );
        }
        const verified = contact.orcid?.nativeStatus === "oauth-verified";
        const assertions = [
          contact.personAssertion,
          contact.membership.assertion,
          contact.orcid?.assertion,
        ];
        if (
          local &&
          (verified ||
            contact.membership.nativeStatus !== "listed-member" ||
            assertions.some((a) => a?.basis === "external-verified"))
        ) {
          issue(
            ["candidateContacts", index],
            "An offline roster cannot carry elevated identity claims.",
          );
        }
        if (
          verified &&
          (contact.orcid?.assertion.basis !== "external-verified" ||
            contact.orcid.assertion.evidence.reference === null)
        ) {
          issue(
            ["candidateContacts", index],
            "OAuth verification needs external-verified evidence.",
          );
        }
      });
      value.candidateCreditClaims.forEach((claim, index) => {
        if (!members.has(claim.sourceMemberRef)) {
          issue(["candidateCreditClaims", index], "Credit claim refers to an absent member.");
        }
        if (
          local &&
          [claim.assertion, claim.output.assertion].some((a) => a.basis === "external-verified")
        ) {
          issue(
            ["candidateCreditClaims", index],
            "An offline roster cannot carry external-verified assertions.",
          );
        }
      });
      if (value.sourceDocument.consent.status === "revoked" && accepted > 0) {
        issue(["sourceDocument", "consent"], "A revoked roster carries no observations.");
      }
    }
  });
export type SourceCreditObservationsV2 = z.infer<typeof sourceCreditObservationsV2Schema>;

/** Explicit version dispatch for consumers that hold either version. */
export const sourceCreditObservationsAnyVersionSchema = z.union([
  sourceCreditObservationsSchema,
  sourceCreditObservationsV2Schema,
]);
