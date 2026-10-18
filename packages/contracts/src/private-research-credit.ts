import { z } from "zod";

/**
 * R0 foundation for private, user-owned cross-project discoveries.
 * Contracts only: these schemas do not authorize access and do not publish data.
 * See docs/private-research-credit.md and ORAtlas issues #202 / #207.
 */
export const PRIVATE_CROSS_FINDING_VERSION = "oratlas.private-cross-finding/0.1.0" as const;

export const CREDIT_ROLE_IDS = [
  "conceptualization",
  "data-curation",
  "formal-analysis",
  "funding-acquisition",
  "investigation",
  "methodology",
  "project-administration",
  "resources",
  "software",
  "supervision",
  "validation",
  "visualization",
  "writing-original-draft",
  "writing-review-editing",
] as const;

/** The 14 ANSI/NISO CRediT contribution roles, not publication authorship. */
export const creditRoleSchema = z.enum(CREDIT_ROLE_IDS);
export type PrivateCreditRole = z.infer<typeof creditRoleSchema>;

export const CREDIT_ROLE_LABELS: Readonly<Record<PrivateCreditRole, string>> = {
  conceptualization: "Conceptualization",
  "data-curation": "Data curation",
  "formal-analysis": "Formal analysis",
  "funding-acquisition": "Funding acquisition",
  investigation: "Investigation",
  methodology: "Methodology",
  "project-administration": "Project administration",
  resources: "Resources",
  software: "Software",
  supervision: "Supervision",
  validation: "Validation",
  visualization: "Visualization",
  "writing-original-draft": "Writing – original draft",
  "writing-review-editing": "Writing – review & editing",
};

const boundedId = z.string().trim().min(1).max(200);
const sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const timestamp = z.string().datetime({ offset: true });
const orcid = z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u);

/**
 * Exact project-owned artifact identity. A DOI or ORCID is NOT permission, an
 * independence claim or proof that two evidence statements are equivalent.
 */
export const privateResearchSourceRefSchema = z
  .object({
    sourceKey: boundedId,
    projectId: boundedId,
    producer: z.enum(["diggypaper", "computational-review-template", "external"]),
    kind: z.enum([
      "source-paper-finding",
      "review-claim",
      "dataset",
      "publication",
      "working-document",
      "analysis",
    ]),
    artifactId: boundedId,
    artifactVersion: boundedId,
    artifactSha256: sha256,
    sourceSnapshotSha256: sha256.optional(),
    /** Bibliographic metadata only; no source authority or access granted. */
    doi: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type PrivateResearchSourceRef = z.infer<typeof privateResearchSourceRefSchema>;

/** All personal attribution assertions remain unverified declarations here. */
export const privateCreditAssertionSchema = z
  .object({
    assertionId: boundedId,
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("cross-finding") }).strict(),
      z.object({ kind: z.literal("source"), sourceKey: boundedId }).strict(),
    ]),
    /** The actor is a person. Software/LLM actors belong in activities. */
    person: z
      .object({
        sourcePersonId: boundedId,
        displayName: z.string().trim().min(1).max(300),
        /** Claimed bibliographic/curated identifier; verification is external. */
        assertedOrcid: orcid.optional(),
      })
      .strict(),
    capacity: z.enum([
      "publication-author",
      "source-finding-curator",
      "source-evidence-reviewer",
      "review-author",
      "cross-finding-contributor",
    ]),
    /** Absence means no CRediT role was asserted; never infer one from capacity. */
    creditRole: creditRoleSchema.optional(),
    assertionStatus: z.enum(["proposed", "confirmed", "disputed", "withdrawn"]),
    assertionOrigin: z.enum(["source-declared", "self-declared", "human-confirmed"]),
    evidenceRefSha256: sha256,
    assertedAt: timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.assertionStatus === "confirmed" && value.assertionOrigin !== "human-confirmed") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["assertionStatus"],
        message: "Confirmed CRediT or contribution roles require a human-confirmed assertion.",
      });
    }
    if (value.capacity === "publication-author" && value.target.kind === "cross-finding") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["target"],
        message: "An original publication author is not automatically author of a new insight.",
      });
    }
  });
export type PrivateCreditAssertion = z.infer<typeof privateCreditAssertionSchema>;

/** Software is an activity participant, never an ORCID person or CRediT author. */
export const privateResearchActivitySchema = z.discriminatedUnion("actorKind", [
  z
    .object({
      actorKind: z.literal("human"),
      activityId: boundedId,
      kind: z.enum(["proposed-connection", "curated-connection", "validated-connection"]),
      localSubjectId: boundedId,
      at: timestamp,
      inputSha256: z.array(sha256).min(1).max(50),
    })
    .strict(),
  z
    .object({
      actorKind: z.literal("software"),
      activityId: boundedId,
      kind: z.enum(["proposed-connection", "compared-sources"]),
      softwareId: boundedId,
      softwareVersion: boundedId,
      runId: boundedId,
      provider: z.string().trim().max(120).optional(),
      model: z.string().trim().max(120).optional(),
      at: timestamp,
      inputSha256: z.array(sha256).min(1).max(50),
    })
    .strict(),
]);
export type PrivateResearchActivity = z.infer<typeof privateResearchActivitySchema>;

/**
 * Candidate associations do not mean support, contradiction, replication or truth.
 * Private records remain outside the public review / PublicationVersion / KG models.
 */
export const privateCrossFindingSchema = z
  .object({
    schemaVersion: z.literal(PRIVATE_CROSS_FINDING_VERSION),
    findingId: boundedId,
    revision: z.number().int().min(1),
    ownerSubjectId: boundedId,
    visibility: z.literal("owner-only"),
    state: z.enum(["candidate", "human-reviewed", "rejected"]),
    relation: z.enum(["potentially-related", "possible-contradiction", "research-question"]),
    hypothesis: z.string().trim().min(1).max(5000),
    createdAt: timestamp,
    sources: z.tuple([privateResearchSourceRefSchema, privateResearchSourceRefSchema]),
    credit: z.array(privateCreditAssertionSchema).max(100),
    activities: z.array(privateResearchActivitySchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const [a, b] = value.sources;
    if (a.projectId === b.projectId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message: "A cross-project discovery requires two distinct project identities.",
      });
    }
    if (a.sourceKey === b.sourceKey) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sources"],
        message: "Both source keys must be distinct.",
      });
    }
    const keys = new Set(value.sources.map((source) => source.sourceKey));
    const assertions = new Set<string>();
    for (const [index, record] of value.credit.entries()) {
      if (assertions.has(record.assertionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["credit", index, "assertionId"],
          message: "Contribution assertion IDs are unique within a finding revision.",
        });
      }
      assertions.add(record.assertionId);
      if (record.target.kind === "source" && !keys.has(record.target.sourceKey)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["credit", index, "target"],
          message: "Contribution target must reference an exact source in this finding.",
        });
      }
    }
    const activityIds = value.activities.map((activity) => activity.activityId);
    if (new Set(activityIds).size !== activityIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["activities"],
        message: "Activity IDs must be unique.",
      });
    }
  });
export type PrivateCrossFinding = z.infer<typeof privateCrossFindingSchema>;
