import { z } from "zod";
import {
  isChecksumValidOrcid,
  isExampleDoi,
  type SourceCreditObservationsV2,
  type SourceCreditPersonV2,
  type SourceCreditTarget,
} from "@oratlas/contracts";
import {
  SourceCreditAdapterError,
  digest,
  finishDraft,
  mapCreditRole,
  parseNative,
  parseSource,
  shaSchema,
  sortedStrings,
  startDraft,
  text,
  tupleId,
  uniqueOrThrow,
} from "./source-credit-adapter-shared.js";

/**
 * Offline, private ONLY. Run CRT's `validateCompanions` on the original bytes
 * first; this projection re-checks the frozen `comprev.contributorship/1`
 * private structure and the identity subset that matters to an importer.
 */
const id = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u);
const timestamp = z.string().datetime();
const claimId = z.string().regex(/^clm_[a-f0-9]{16}$/u);
const nullableText = text.nullable();
const creditSlug = z.enum([
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
]);
const disclosure = z
  .object({
    public: z.boolean(),
    reason: z.string().max(500).nullable(),
    approved_fields: z
      .array(z.enum(["display_name", "orcid", "credit_assertions"]))
      .max(3)
      .optional(),
    approval_ids: z.array(text).max(100),
  })
  .strict();
type Disclosure = z.infer<typeof disclosure>;
const legacyLabelFields = {
  field: z.enum(["roles", "credit_levels"]),
  position: z.number().int().min(0),
  label: z.string().max(500).nullable(),
  level: z.string().max(500).nullable(),
  mapped_role: creditSlug.nullable(),
  mapping: z.enum(["exact", "normalized", "unmappable"]),
};

const crtSchema = z
  .object({
    schema: z.literal("comprev.contributorship/1"),
    visibility: z.literal("private"),
    credit_standard: z.literal("ANSI/NISO Z39.104-2022"),
    subject: z
      .object({
        review_id: z.string().regex(/^review-[a-z0-9][a-z0-9-]{2,63}$/u),
        version: z.string().regex(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u),
        claim_graph_sha256: shaSchema,
      })
      .strict(),
    contributors: z
      .array(
        z
          .object({
            id,
            kind: z.literal("person"),
            display_name: text,
            orcid: z
              .object({
                id: z.string().regex(/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/u),
                status: z.enum(["claimed", "verified"]),
                verification: z
                  .object({
                    method: z.enum(["orcid-oauth", "controller-check"]),
                    ref: text,
                    verified_at: timestamp,
                  })
                  .strict()
                  .optional(),
              })
              .strict()
              .nullable(),
            legacy_author_id: nullableText,
            credit_statement: z.string().min(1).nullable(),
            disclosure,
          })
          .strict(),
      )
      .max(1000),
    credit_assertions: z
      .array(
        z
          .object({
            assertion_id: z.string().regex(/^[a-z0-9][a-z0-9:._-]{0,127}$/u),
            contributor: id,
            role: creditSlug,
            role_label: text,
            role_uri: z
              .string()
              .regex(/^https:\/\/credit\.niso\.org\/contributor-roles\/[a-z-]+\/$/u),
            degree: z.enum(["lead", "equal", "supporting"]).nullable(),
            status: z.enum(["declared", "confirmed", "disputed", "withdrawn"]),
            status_ref: nullableText,
            source_kind: z.enum([
              "self-declared",
              "corresponding-author",
              "controller",
              "legacy-author-file",
            ]),
            source_ref: text,
            asserted_at: timestamp.nullable(),
            target: z.discriminatedUnion("kind", [
              z.object({ kind: z.literal("review") }).strict(),
              z.object({ kind: z.literal("claim"), claim_id: claimId }).strict(),
            ]),
          })
          .strict(),
      )
      .max(10000),
    legacy_role_labels: z
      .array(
        z
          .object({
            ...legacyLabelFields,
            credit_eligible: z.boolean(),
            contributor: id,
            source_ref: text,
          })
          .strict(),
      )
      .max(10000),
    production: z
      .object({
        agent_runs: z
          .array(
            z
              .object({
                agent_id: id,
                kind: z.literal("software-agent"),
                name: text,
                version: nullableText,
                workflow_role: nullableText,
                producer: nullableText,
                credit_channel: z.literal("production"),
                legacy_author_id: nullableText,
                legacy_role_labels: z
                  .array(
                    z.object({ ...legacyLabelFields, credit_eligible: z.literal(false) }).strict(),
                  )
                  .max(1000),
              })
              .strict(),
          )
          .max(1000),
      })
      .strict(),
    source_origins: z
      .array(
        z
          .object({
            origin_id: id,
            packet_id: z
              .string()
              .regex(/^packet:/u)
              .max(500),
            visibility: z.enum(["public", "private"]),
            project_ref: nullableText,
            project_title: z.string().min(1).nullable(),
            disclosure,
          })
          .strict(),
      )
      .max(1000),
    source_credit: z
      .array(
        z
          .object({
            claim_id: claimId,
            disclosure,
            findings: z
              .array(
                z
                  .object({
                    finding_id: z
                      .string()
                      .regex(/^finding:/u)
                      .max(500),
                    finding_revision: z.number().int().positive(),
                    phase2_finding_sha256: shaSchema,
                    binding: z.literal("reviewed-mapping"),
                    origin_id: id,
                    decision_ref: text,
                    mapped_at: timestamp,
                    lineage_sha256: shaSchema,
                    packet: z
                      .object({
                        packet_id: z
                          .string()
                          .regex(/^packet:/u)
                          .max(500),
                        manifest_sha256: shaSchema,
                      })
                      .strict(),
                    cited_work: z
                      .object({
                        credit_kind: z.literal("bibliographic-citation"),
                        cite_key: z.string().max(500).nullable(),
                        doi: z.string().regex(/^10\./u).max(500),
                        authors: z.array(text).max(500),
                      })
                      .strict(),
                    passage_disclosure: z.enum(["rights-allow", "rights-restricted"]),
                    passages: z
                      .array(
                        z
                          .object({
                            passage_id: z
                              .string()
                              .regex(/^passage:/u)
                              .max(500),
                            quote_sha256: shaSchema,
                          })
                          .strict(),
                      )
                      .max(500),
                    source_assessments: z
                      .array(
                        z
                          .object({
                            assessment_id: z
                              .string()
                              .regex(/^assessment:/u)
                              .max(500),
                            protocol: text,
                            status: text,
                            curator_ref: text,
                            curator_ref_kind: z.literal("source-native-pseudonym"),
                          })
                          .strict(),
                      )
                      .max(500),
                    source_curation: z
                      .object({
                        credit_channel: z.literal("source-native"),
                        review_authorship: z.literal(false),
                      })
                      .strict(),
                  })
                  .strict(),
              )
              .min(1)
              .max(1000),
          })
          .strict(),
      )
      .max(10000),
    relation_proposals: z
      .array(
        z
          .object({
            relation_id: text,
            proposed_by: id,
            predicate: z.enum(["supports", "contradicts", "qualifies"]),
            claim_id: claimId.optional(),
            finding_refs: z
              .array(
                z
                  .object({
                    finding_id: z.string().regex(/^finding:/u),
                    finding_revision: z.number().int().min(1),
                  })
                  .strict(),
              )
              .min(2),
            proposed_at: timestamp,
            rationale: z.string().min(1).nullable(),
            disclosure,
          })
          .strict(),
      )
      .max(10000),
  })
  .strict();

const disclosureFacts = (value: Disclosure) => ({
  public: value.public,
  reason: value.reason === "" ? null : value.reason,
  approvedFields: value.approved_fields ? sortedStrings(value.approved_fields) : null,
  approvalIds: sortedStrings(value.approval_ids),
});

export function adaptCRTContributorship(
  raw: string,
  claimGraphRaw?: string,
): SourceCreditObservationsV2 {
  const doc = parseNative(crtSchema, parseSource(raw));
  if (claimGraphRaw !== undefined && digest(claimGraphRaw) !== doc.subject.claim_graph_sha256) {
    throw new SourceCreditAdapterError("claim-graph-sha256-mismatch");
  }
  const output = startDraft(
    "computational-review-template",
    doc.subject.review_id + ":" + doc.subject.version,
    raw,
    {
      kind: "crt-contributorship",
      reviewId: doc.subject.review_id,
      version: doc.subject.version,
      claimGraphSha256: doc.subject.claim_graph_sha256,
      claimGraphBytesVerified: claimGraphRaw !== undefined,
      visibility: "private",
      creditStandard: "ANSI/NISO Z39.104-2022",
    },
  );
  const reviewTarget: SourceCreditTarget = {
    kind: "review",
    sourceId: doc.subject.review_id,
    sourceVersion: doc.subject.version,
    bindingSha256: doc.subject.claim_graph_sha256,
    packetId: null,
    packetManifestSha256: null,
    lineageSha256: null,
  };

  uniqueOrThrow(
    doc.contributors.map((c) => c.id),
    "duplicate-crt-contributor",
  );
  uniqueOrThrow(
    doc.credit_assertions.map((c) => c.assertion_id),
    "duplicate-crt-assertion",
  );
  uniqueOrThrow(
    doc.source_origins.map((o) => o.origin_id),
    "duplicate-crt-origin",
  );
  uniqueOrThrow(
    doc.production.agent_runs.map((a) => a.agent_id),
    "crt-duplicate-software",
  );
  const contributors = new Map(doc.contributors.map((c) => [c.id, c]));
  if (doc.production.agent_runs.some((agent) => contributors.has(agent.agent_id))) {
    throw new SourceCreditAdapterError("crt-agent-person-conflict");
  }
  if (doc.contributors.some((c) => c.orcid && !isChecksumValidOrcid(c.orcid.id))) {
    throw new SourceCreditAdapterError("source-identity-invalid");
  }
  if (doc.contributors.some((c) => c.credit_statement !== null)) {
    output.report.omittedSourceFields.push("crt.contributors.credit-statement");
  }
  const origins = new Map(doc.source_origins.map((o) => [o.origin_id, o]));
  if (doc.source_origins.some((o) => o.project_ref !== null || o.project_title !== null)) {
    // Private project metadata never leaves the source companion via this adapter.
    output.report.omittedSourceFields.push("crt.source-origins.project-ref-and-title");
  }

  for (const declaration of doc.credit_assertions) {
    const contributor = contributors.get(declaration.contributor);
    if (!contributor) throw new SourceCreditAdapterError("crt-dangling-contributor");
    if ((declaration.status === "declared") !== (declaration.status_ref === null)) {
      throw new SourceCreditAdapterError("crt-status-decision-invalid");
    }
    const orcid = contributor.orcid;
    const verified = orcid?.status === "verified";
    if (verified !== Boolean(orcid?.verification)) {
      throw new SourceCreditAdapterError("crt-orcid-evidence-missing");
    }
    const person: SourceCreditPersonV2 = {
      kind: "named",
      sourcePersonId: contributor.id,
      legacySourcePersonId: contributor.legacy_author_id,
      displayName: contributor.display_name,
      orcid: orcid && {
        id: orcid.id,
        sourceStatus: verified ? "source-verified" : "claimed",
        nativeStatus: orcid.status,
        verificationMethod: orcid.verification?.method ?? null,
        verificationRef: orcid.verification?.ref ?? null,
        verifiedAt: orcid.verification?.verified_at ?? null,
      },
    };
    const mapped = mapCreditRole(declaration.role);
    if (
      mapped &&
      (mapCreditRole(declaration.role_label) !== mapped ||
        declaration.role_uri !== `https://credit.niso.org/contributor-roles/${mapped}/`)
    ) {
      throw new SourceCreditAdapterError("crt-role-label-inconsistent");
    }
    if (!mapped) {
      output.report.unmappable++;
      output.report.reasonCodes.push("unmapped-credit-role");
    }
    const target: SourceCreditTarget =
      declaration.target.kind === "review"
        ? reviewTarget
        : { ...reviewTarget, kind: "review-claim", sourceId: declaration.target.claim_id };
    // The private companion legitimately holds the identity; `public: false`
    // is a source fact that is counted, not a licence to erase or to publish.
    if (!contributor.disclosure.public) output.report.withheld++;
    output.assertions.push({
      observationId: tupleId("computational-review-template", "credit", [declaration.assertion_id]),
      target,
      sourceAssertionId: declaration.assertion_id,
      person,
      capacity: declaration.target.kind === "review" ? "review-contributor" : "claim-contributor",
      role: mapped
        ? {
            slug: mapped,
            originalLabel: declaration.role_label,
            degree: declaration.degree,
            declarationRef: declaration.source_ref,
            roleUri: declaration.role_uri,
          }
        : null,
      sourceStatus: declaration.status,
      sourceDecisionRef: declaration.status_ref,
      sourceDeclarationKind: declaration.source_kind,
      sourceAssertedAt: declaration.asserted_at,
      sourceDisclosure: { kind: "crt-contributor", ...disclosureFacts(contributor.disclosure) },
      sourceAudience: doc.visibility,
      destinationStatus: "not-adjudicated",
      oratlasDisclosure: "not-authorized",
      assessmentIds: [],
    });
  }

  const legacyKeys: string[] = [];
  for (const label of doc.legacy_role_labels) {
    if (!contributors.has(label.contributor)) {
      throw new SourceCreditAdapterError("crt-dangling-contributor");
    }
    const parts = ["person", label.contributor, label.field, label.position];
    legacyKeys.push(JSON.stringify(parts));
    output.sourceLegacyRoleLabels.push({
      observationId: tupleId("computational-review-template", "legacy-role-label", parts),
      target: reviewTarget,
      subject: { kind: "person", sourcePersonId: label.contributor },
      field: label.field,
      position: label.position,
      label: label.label === "" ? null : label.label,
      level: label.level === "" ? null : label.level,
      sourceMappedRole: label.mapped_role,
      sourceMapping: label.mapping,
      sourceCreditEligible: label.credit_eligible,
      sourceRef: label.source_ref,
    });
  }

  const seenFindings = new Map<string, string>();
  const seenClaimFindings = new Set<string>();
  for (const record of doc.source_credit) {
    for (const entry of record.findings) {
      const origin = origins.get(entry.origin_id);
      if (!origin || origin.packet_id !== entry.packet.packet_id) {
        throw new SourceCreditAdapterError("crt-origin-binding-invalid");
      }
      const key = JSON.stringify([entry.finding_id, entry.finding_revision]);
      const earlierPacket = seenFindings.get(key);
      if (earlierPacket !== undefined && earlierPacket !== entry.packet.packet_id) {
        throw new SourceCreditAdapterError("crt-duplicate-finding");
      }
      const claimKey = JSON.stringify([record.claim_id, key]);
      if (seenClaimFindings.has(claimKey)) {
        throw new SourceCreditAdapterError("crt-duplicate-finding");
      }
      seenClaimFindings.add(claimKey);
      seenFindings.set(key, entry.packet.packet_id);
      uniqueOrThrow(
        entry.passages.map((p) => p.passage_id),
        "crt-duplicate-passage",
      );
      uniqueOrThrow(
        entry.source_assessments.map((a) => a.assessment_id),
        "crt-duplicate-assessment",
      );
      output.evidence.push({
        observationId: tupleId("computational-review-template", "evidence", [
          record.claim_id,
          entry.finding_id,
          entry.finding_revision,
        ]),
        target: {
          kind: "source-finding",
          sourceId: entry.finding_id,
          sourceVersion: String(entry.finding_revision),
          bindingSha256: entry.phase2_finding_sha256,
          packetId: entry.packet.packet_id,
          packetManifestSha256: entry.packet.manifest_sha256,
          lineageSha256: entry.lineage_sha256,
        },
        nativeBinding: "crt-reviewed-mapping",
        sourceEntryId: null, // CRT has no credit-entry ids; a claim id is not one.
        sourcePaperId: null,
        findingOrigin: null,
        sourceSnapshotRef: null,
        sourceSnapshotSha256: null,
        phase2FindingSha256: entry.phase2_finding_sha256,
        citedWork: {
          doi: entry.cited_work.doi,
          doiIsExample: isExampleDoi(entry.cited_work.doi),
          citeKey: entry.cited_work.cite_key === "" ? null : entry.cited_work.cite_key,
          authors: entry.cited_work.authors,
          authorsAre: "bibliographic-citation-metadata",
        },
        nativeOrigin: {
          originId: entry.origin_id,
          visibility: origin.visibility,
          disclosure: disclosureFacts(origin.disclosure),
        },
        mapping: {
          binding: entry.binding,
          claimId: record.claim_id,
          decisionRef: entry.decision_ref,
          mappedAt: entry.mapped_at,
          claimDisclosure: disclosureFacts(record.disclosure),
        },
        sourceRights: {
          kind: "crt-passage-disclosure",
          passageDisclosure: entry.passage_disclosure,
        },
        passages: entry.passages
          .map((p) => ({ passageId: p.passage_id, quoteSha256: p.quote_sha256, quoteState: null }))
          .sort((a, b) => (a.passageId < b.passageId ? -1 : 1)),
        assessmentProtocol: null,
        sourceAssessments: entry.source_assessments
          .map((a) => ({
            assessmentId: a.assessment_id,
            protocol: a.protocol,
            status: a.status,
            curatorRef: { kind: a.curator_ref_kind, ref: a.curator_ref },
            assessedSnapshotSha256: null,
          }))
          .sort((a, b) => (a.assessmentId < b.assessmentId ? -1 : 1)),
        oratlasAdjudication: "none",
      });
      if (origin.visibility === "private" || !record.disclosure.public) output.report.withheld++;
    }
  }

  for (const agent of doc.production.agent_runs) {
    output.production.push({
      observationId: tupleId("computational-review-template", "production", [agent.agent_id]),
      target: reviewTarget,
      softwareName: agent.name,
      softwareVersion: agent.version,
      softwareProducer: agent.producer,
      agentType: agent.kind,
      sourceAgentId: agent.agent_id,
      runRef: null, // CRT records an agent, not a run.
      activity: agent.workflow_role,
      legacyAuthorId: agent.legacy_author_id,
      creditChannel: agent.credit_channel,
      actorKind: "software",
    });
    for (const label of agent.legacy_role_labels) {
      const parts = ["software-agent", agent.agent_id, label.field, label.position];
      legacyKeys.push(JSON.stringify(parts));
      output.sourceLegacyRoleLabels.push({
        observationId: tupleId("computational-review-template", "legacy-role-label", parts),
        target: reviewTarget,
        subject: { kind: "software-agent", sourceAgentId: agent.agent_id },
        field: label.field,
        position: label.position,
        label: label.label === "" ? null : label.label,
        level: label.level === "" ? null : label.level,
        sourceMappedRole: label.mapped_role,
        sourceMapping: label.mapping,
        sourceCreditEligible: label.credit_eligible,
        sourceRef: null,
      });
    }
  }
  uniqueOrThrow(legacyKeys, "crt-duplicate-legacy-label");

  // Existing CRT relation_proposals remain source-native proposals, not
  // confirmed ORAtlas claim→finding or cross-project edges.
  if (doc.relation_proposals.length) {
    output.report.unmappable += doc.relation_proposals.length;
    output.report.reasonCodes.push("crt-relation-proposals-not-authoritative");
    output.report.omittedSourceFields.push("crt.relation-proposals");
  }
  if (claimGraphRaw === undefined) output.report.reasonCodes.push("claim-graph-bytes-not-supplied");
  return finishDraft(output);
}
