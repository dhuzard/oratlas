import { z } from "zod";
import {
  isChecksumValidOrcid,
  isExampleDoi,
  type SourceCreditAssertionV2,
  type SourceCreditObservationsV2,
  type SourceCreditPersonV2,
  type SourceCreditTarget,
} from "@oratlas/contracts";
import {
  SourceCreditAdapterError,
  digest,
  finishDraft,
  mapCreditRole,
  naToNull,
  parseJsonl,
  parseNative,
  parseSource,
  sameSet,
  shaSchema,
  sortedStrings,
  startDraft,
  text,
  tupleId,
  uniqueOrThrow,
} from "./source-credit-adapter-shared.js";

/**
 * Offline, private ONLY. Must be used after Diggypaper's own reference
 * validator (`fcc_validate.py`). This adapter re-checks the frozen structural
 * constants and the identity/privacy subset of those semantic rules, so that a
 * DOI, repeated finding id, stale revision or disclosed-but-inactive credit is
 * never treated as a new identity. It is not a port of the full validator.
 */
export interface DiggypaperCreditPacket {
  manifest: string;
  papers: string;
  findings: string;
  passages: string;
  assessments: string;
}

const timestamp = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/u);
const timestampOrNA = z.union([timestamp, z.literal("not-available")]);
const nativeId = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}:[A-Za-z0-9._-]{1,100}$`, "u"));
const pseudonym = z.string().regex(/^rv-[0-9a-f]{16,64}$/u);
const shaOrNA = z.union([shaSchema, z.literal("not-available")]);
const uniqueIds = (prefix: string) =>
  z
    .array(nativeId(prefix))
    .max(500)
    .refine((values) => new Set(values).size === values.length);

/** Labels enumerated by the frozen schema (CRediT ANSI/NISO Z39.104-2022). */
const CREDIT_LABELS = [
  "Conceptualization",
  "Data curation",
  "Formal analysis",
  "Funding acquisition",
  "Investigation",
  "Methodology",
  "Project administration",
  "Resources",
  "Software",
  "Supervision",
  "Validation",
  "Visualization",
  "Writing – original draft",
  "Writing – review & editing",
] as const;

const contributionSchema = z
  .object({
    contribution_id: nativeId("contribution"),
    capacity: z.enum(["finding-proposer", "finding-curator", "support-assessor", "project-team"]),
    status: z.enum([
      "source-declared",
      "self-declared",
      "confirmed",
      "withheld",
      "disputed",
      "withdrawn",
    ]),
    contributor: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("pseudonym"), ref: pseudonym }).strict(),
      z.object({ kind: z.literal("withheld"), ref: z.literal("attribution-withheld") }).strict(),
      z
        .object({
          kind: z.literal("disclosed"),
          display_name: z.string().min(1).max(200),
          orcid: z.union([
            z.literal("not-available"),
            z
              .object({
                id: z.string().regex(/^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$/u),
                verification: z.enum(["oauth-verified", "claimed-unverified"]),
                verified_at: timestampOrNA,
                verification_ref: z
                  .string()
                  .regex(/^(orcid-verification:[A-Za-z0-9._-]{1,100}|not-available)$/u),
              })
              .strict(),
          ]),
        })
        .strict(),
    ]),
    credit_roles: z
      .array(
        z
          .object({
            role: z.enum(CREDIT_LABELS),
            degree: z.enum(["lead", "equal", "supporting", "not-available"]),
            declaration_ref: nativeId("declaration"),
          })
          .strict(),
      )
      .max(CREDIT_LABELS.length * 4),
    assessment_ids: uniqueIds("assessment"),
    review_blinding: z.enum(["blinded", "unblinded", "unknown", "not-applicable"]),
    disclosure: z
      .object({
        person_consent: z.enum(["granted", "not-granted", "revoked", "not-applicable"]),
        controller_authorization: z.enum(["granted", "not-granted", "revoked"]),
        membership: z.enum(["active", "revoked", "unknown"]),
        consent_ref: z.string().regex(/^(consent:[A-Za-z0-9._-]{1,100}|not-available)$/u),
      })
      .strict(),
  })
  .strict();
type Contribution = z.infer<typeof contributionSchema>;

const companionSchema = z
  .object({
    schema_version: z.literal("finding-credit-companion/0.1.0"),
    companion_id: z.string().regex(/^credit:[A-Za-z0-9._-]{1,100}$/u),
    created_at: timestamp,
    creation_method: z.enum(["producer-export", "synthetic-fixture", "manual"]),
    producer: z
      .object({
        name: text,
        commit: z.string().regex(/^([0-9a-f]{40}|synthetic-fixture)$/u),
      })
      .strict(),
    packet: z
      .object({
        schema_version: z.literal("source-evidence-packet/0.1.0"),
        packet_id: nativeId("packet"),
        packet_digest: shaSchema,
      })
      .strict(),
    audience: z
      .object({
        level: z.enum(["public", "named-recipient", "project-members"]),
        recipient_ref: z.string().regex(/^(recipient:[A-Za-z0-9._-]{1,100}|not-available)$/u),
        purpose: z.string().min(1).max(500),
        expires_at: timestampOrNA,
      })
      .strict(),
    release: z
      .object({
        state: z.enum(["controller-approved", "not-released"]),
        approval_ref: z.string().regex(/^(approval:[A-Za-z0-9._-]{1,100}|not-available)$/u),
        approved_at: timestampOrNA,
      })
      .strict(),
    credit_semantics: z
      .object({
        role_vocabulary: z.literal("CRediT ANSI/NISO Z39.104-2022"),
        implies_authorship: z.literal(false),
      })
      .strict(),
    entries: z
      .array(
        z
          .object({
            entry_id: nativeId("credit-entry"),
            binding: z
              .object({
                packet_digest: shaSchema,
                finding_id: nativeId("finding"),
                finding_revision: z.number().int().positive(),
                finding_origin: z.enum([
                  "source-explicit",
                  "ai-paraphrase",
                  "reviewer-interpretation",
                ]),
                paper_id: nativeId("paper"),
                source_snapshot_ref: text,
                source_snapshot_sha256: shaOrNA,
                passage_ids: uniqueIds("passage"),
                assessment_protocol: z.literal("seip-support-v1"),
                assessment_ids: uniqueIds("assessment"),
              })
              .strict(),
            contributions: z.array(contributionSchema).max(1000),
            production: z
              .array(
                z
                  .object({
                    agent_type: z.enum(["software", "ml-model"]),
                    name: z.string().min(1).max(200),
                    version: z.string().min(1).max(100),
                    activity: z.enum(["extraction", "paraphrase", "quote-matching", "proposal"]),
                    run_ref: z.string().min(1).max(200),
                  })
                  .strict(),
              )
              .max(100),
          })
          .strict(),
      )
      .max(10000),
    export_status: z
      .object({
        state: z.enum(["complete", "partial", "withheld"]),
        withheld_counts: z
          .object({ entries: z.number().int().min(0), contributions: z.number().int().min(0) })
          .strict(),
        reasons: z.array(text).max(200),
      })
      .strict(),
  })
  .strict();
type Companion = z.infer<typeof companionSchema>;

const packetManifestSchema = z.object({
  packet_id: z.string(),
  schema_version: z.literal("source-evidence-packet/0.1.0"),
  access_scope: z.object({ level: text }),
  licenses: z.array(z.object({ applies_to: text, license_id: text })).max(50),
  producer: z.object({ name: text, commit: text }),
  artifacts: z.record(
    z.object({
      sha256: shaSchema,
      bytes: z.number().int().nonnegative(),
      record_count: z.number().int().nonnegative(),
    }),
  ),
});

// Only the packet fields this adapter reads; the packet's own validator owns the rest.
const paperSchema = z.object({
  paper_id: z.string(),
  authors: z.array(text).max(500),
  identifiers: z.object({ doi: text }),
  rights: z.object({ license: text, redistribution: text, full_text_included: z.boolean() }),
  source_snapshot: z.object({ snapshot_ref: z.string(), sha256: z.string() }),
});
const findingSchema = z.object({
  finding_id: z.string(),
  revision: z.number().int().positive(),
  paper_id: z.string(),
  origin: z.string(),
  passage_ids: z.array(z.string()),
  export_state: z.string(),
});
const passageSchema = z.object({
  passage_id: z.string(),
  paper_id: z.string(),
  quote_sha256: shaSchema,
  quote_state: text,
});
const assessmentSchema = z.object({
  assessment_id: z.string(),
  finding_id: z.string(),
  finding_revision: z.number().int().positive(),
  protocol: text,
  status: text,
  reviewer_ref: z.string(),
  assessed_snapshot_sha256: z.string(),
});

const AUDIENCE_PACKET_LEVELS: Record<Companion["audience"]["level"], readonly string[]> = {
  public: ["public"],
  "named-recipient": ["public", "restricted"],
  "project-members": ["public", "restricted", "private", "embargoed"],
};
const NOT_REDISTRIBUTABLE = new Set(["restricted", "unknown"]);
const INACTIVE_STATUSES = new Set(["withheld", "disputed", "withdrawn"]);

function validatedPacket(packet: DiggypaperCreditPacket) {
  const manifest = parseNative(packetManifestSchema, parseSource(packet.manifest));
  const sources = {
    papers: packet.papers,
    findings: packet.findings,
    passages: packet.passages,
    assessments: packet.assessments,
  };
  const records: Record<string, Record<string, unknown>[]> = {};
  for (const [name, bytes] of Object.entries(sources)) {
    const info = manifest.artifacts[name];
    const parsed = parseJsonl(bytes);
    if (
      !info ||
      digest(bytes) !== info.sha256 ||
      Buffer.byteLength(bytes, "utf8") !== info.bytes ||
      parsed.length !== info.record_count
    ) {
      throw new SourceCreditAdapterError("packet-artifact-digest-mismatch");
    }
    records[name] = parsed;
  }
  const typed = <T>(schema: z.ZodType<T>, name: string): T[] =>
    (records[name] ?? []).map((record) => {
      const result = schema.safeParse(record);
      if (!result.success) throw new SourceCreditAdapterError("packet-record-incompatible");
      return result.data;
    });
  return {
    manifest,
    manifestDigest: digest(packet.manifest),
    papers: typed(paperSchema, "papers"),
    findings: typed(findingSchema, "findings"),
    passages: typed(passageSchema, "passages"),
    assessments: typed(assessmentSchema, "assessments"),
  };
}

const timeOf = (value: string) => Date.parse(value);

/** Header rules from fcc_validate.py `_check_header` (the time-of-use expiry is the caller's). */
function checkHeader(doc: Companion): void {
  const { audience, release, export_status: status } = doc;
  if ((audience.level === "named-recipient") !== (audience.recipient_ref !== "not-available")) {
    throw new SourceCreditAdapterError("source-audience-inconsistent");
  }
  if (audience.expires_at === "not-available") {
    if (audience.level !== "public")
      throw new SourceCreditAdapterError("source-handoff-expiry-missing");
  } else if (timeOf(audience.expires_at) <= timeOf(doc.created_at)) {
    throw new SourceCreditAdapterError("source-handoff-expired");
  }
  const approved = release.state === "controller-approved";
  const approvalData = [release.approval_ref, release.approved_at];
  if (
    approved
      ? approvalData.includes("not-available") ||
        timeOf(release.approved_at) > timeOf(doc.created_at)
      : approvalData.some((value) => value !== "not-available")
  ) {
    throw new SourceCreditAdapterError("source-release-inconsistent");
  }
  if (audience.level !== "project-members" && !approved) {
    throw new SourceCreditAdapterError("source-release-not-approved");
  }
  const omitted = status.withheld_counts.entries + status.withheld_counts.contributions;
  if (
    (status.state === "complete" && omitted > 0) ||
    (status.state === "partial" && omitted === 0) ||
    (status.state === "withheld" && (doc.entries.length > 0 || status.reasons.length === 0))
  ) {
    throw new SourceCreditAdapterError("source-export-status-inconsistent");
  }
}

/** Identity/privacy subset of fcc_validate.py `_check_contribution`. */
function checkContribution(
  c: Contribution,
  boundAssessmentIds: readonly string[],
  reviewerOf: ReadonlyMap<string, string>,
  productionNames: ReadonlySet<string>,
): void {
  const who = c.contributor;
  if (c.status === "withheld" && who.kind !== "withheld") {
    throw new SourceCreditAdapterError("disclosure-status-contradiction");
  }
  if (c.credit_roles.length > 0 && INACTIVE_STATUSES.has(c.status)) {
    throw new SourceCreditAdapterError("credit-role-on-inactive-contribution");
  }
  uniqueOrThrow(
    c.credit_roles.map((role) => role.role),
    "duplicate-credit-role",
  );
  if (c.capacity === "support-assessor") {
    if (c.assessment_ids.length === 0 || c.review_blinding === "not-applicable") {
      throw new SourceCreditAdapterError("assessor-binding-mismatch");
    }
    for (const id of c.assessment_ids) {
      if (!boundAssessmentIds.includes(id)) {
        throw new SourceCreditAdapterError("assessor-binding-mismatch");
      }
      if (who.kind === "pseudonym" && reviewerOf.has(id) && reviewerOf.get(id) !== who.ref) {
        throw new SourceCreditAdapterError("assessor-pseudonym-mismatch");
      }
    }
  } else if (c.assessment_ids.length > 0 || c.review_blinding !== "not-applicable") {
    throw new SourceCreditAdapterError("assessor-binding-mismatch");
  }
  if (who.kind !== "disclosed") return;
  const d = c.disclosure;
  if (
    (c.capacity === "support-assessor" && c.review_blinding !== "unblinded") ||
    INACTIVE_STATUSES.has(c.status) ||
    d.person_consent !== "granted" ||
    d.controller_authorization !== "granted" ||
    d.membership !== "active" ||
    d.consent_ref === "not-available"
  ) {
    throw new SourceCreditAdapterError("disclosure-not-authorized");
  }
  if (who.orcid !== "not-available") {
    const proof = [who.orcid.verified_at, who.orcid.verification_ref];
    const verified = who.orcid.verification === "oauth-verified";
    if (
      verified ? proof.includes("not-available") : proof.some((value) => value !== "not-available")
    ) {
      throw new SourceCreditAdapterError("source-orcid-evidence-missing");
    }
    if (!isChecksumValidOrcid(who.orcid.id)) {
      throw new SourceCreditAdapterError("source-identity-invalid");
    }
  }
  if (productionNames.has(who.display_name.trim().toLowerCase())) {
    throw new SourceCreditAdapterError("software-credited-as-person");
  }
}

function personFromSource(c: Contribution): SourceCreditPersonV2 {
  const who = c.contributor;
  // Withdrawn credit stays conservative: no pseudonym or name is carried.
  if (who.kind === "withheld" || c.status === "withdrawn") return { kind: "withheld" };
  if (who.kind === "pseudonym") {
    return { kind: "pseudonym", sourceRef: who.ref, refKind: "source-native-pseudonym" };
  }
  const orcid = who.orcid === "not-available" ? null : who.orcid;
  const verified = orcid?.verification === "oauth-verified";
  return {
    kind: "named",
    sourcePersonId: null, // Diggypaper has no person ids; a contribution id is not one.
    legacySourcePersonId: null,
    displayName: who.display_name,
    orcid: orcid && {
      id: orcid.id,
      sourceStatus: verified ? "source-verified" : "claimed",
      nativeStatus: orcid.verification,
      verificationMethod: null,
      verificationRef: naToNull(orcid.verification_ref),
      verifiedAt: naToNull(orcid.verified_at),
    },
  };
}

export function adaptDiggypaperCredit(
  raw: string,
  packetBytes: DiggypaperCreditPacket,
): SourceCreditObservationsV2 {
  const doc = parseNative(companionSchema, parseSource(raw));
  const packet = validatedPacket(packetBytes);
  const { manifest, manifestDigest } = packet;
  if (manifest.packet_id !== doc.packet.packet_id || manifestDigest !== doc.packet.packet_digest) {
    throw new SourceCreditAdapterError("packet-manifest-binding-mismatch");
  }
  checkHeader(doc);
  if (!AUDIENCE_PACKET_LEVELS[doc.audience.level].includes(manifest.access_scope.level)) {
    throw new SourceCreditAdapterError("source-audience-exceeds-packet-scope");
  }
  const draft = startDraft("diggypaper", doc.companion_id, raw, {
    kind: "diggypaper-companion",
    companionId: doc.companion_id,
    createdAt: doc.created_at,
    creationMethod: doc.creation_method,
    producer: { name: doc.producer.name, commit: doc.producer.commit },
    audience: {
      level: doc.audience.level,
      recipientRef: naToNull(doc.audience.recipient_ref),
      expiresAt: naToNull(doc.audience.expires_at),
    },
    release: {
      state: doc.release.state,
      approvalRef: naToNull(doc.release.approval_ref),
      approvedAt: naToNull(doc.release.approved_at),
    },
    creditSemantics: { roleVocabulary: "CRediT ANSI/NISO Z39.104-2022", impliesAuthorship: false },
    exportStatus: {
      state: doc.export_status.state,
      withheldCounts: { ...doc.export_status.withheld_counts },
      reasons: sortedStrings(doc.export_status.reasons),
    },
    packet: {
      packetId: doc.packet.packet_id,
      schemaVersion: doc.packet.schema_version,
      manifestSha256: manifestDigest,
      accessScopeLevel: manifest.access_scope.level,
      producer: { name: manifest.producer.name, commit: manifest.producer.commit },
    },
  });
  draft.report.producerDeclaredOmissions = {
    state: doc.export_status.state,
    counts: { ...doc.export_status.withheld_counts },
    reasons: sortedStrings(doc.export_status.reasons),
  };
  draft.report.omittedSourceFields.push(
    "diggypaper.audience.purpose",
    "diggypaper.packet.assessment-reviewer-refs-and-rationales",
    "diggypaper.packet.finding-statement-context-and-review-states",
    "diggypaper.packet.paper-title-and-non-doi-identifiers",
    "diggypaper.packet.passage-quote-text",
  );
  uniqueOrThrow(
    doc.entries.map((entry) => entry.entry_id),
    "duplicate-credit-entry",
  );
  uniqueOrThrow(
    doc.entries.flatMap((entry) => entry.contributions.map((c) => c.contribution_id)),
    "duplicate-source-credit-id",
  );
  uniqueOrThrow(
    doc.entries.map(
      (entry) => entry.binding.finding_id + "\u0000" + entry.binding.finding_revision,
    ),
    "duplicate-finding-binding",
  );
  const packetLicenses = manifest.licenses
    .map((license) => ({ appliesTo: license.applies_to, licenseId: license.license_id }))
    .sort((a, b) => (a.appliesTo + a.licenseId < b.appliesTo + b.licenseId ? -1 : 1));

  for (const entry of doc.entries) {
    const b = entry.binding;
    const paper = packet.papers.find((p) => p.paper_id === b.paper_id);
    const finding = packet.findings.find(
      (f) => f.finding_id === b.finding_id && f.revision === b.finding_revision,
    );
    const later = packet.findings.some(
      (f) => f.finding_id === b.finding_id && f.revision > b.finding_revision,
    );
    if (b.packet_digest !== manifestDigest || !paper || !finding || later) {
      throw new SourceCreditAdapterError("finding-revision-or-packet-invalid");
    }
    const assessments = packet.assessments.filter(
      (a) => a.finding_id === b.finding_id && a.finding_revision === b.finding_revision,
    );
    if (
      finding.paper_id !== b.paper_id ||
      finding.origin !== b.finding_origin ||
      paper.source_snapshot.snapshot_ref !== b.source_snapshot_ref ||
      paper.source_snapshot.sha256 !== b.source_snapshot_sha256 ||
      !sameSet(finding.passage_ids, b.passage_ids) ||
      !sameSet(
        assessments.map((a) => a.assessment_id),
        b.assessment_ids,
      ) ||
      assessments.some((a) => a.assessed_snapshot_sha256 !== b.source_snapshot_sha256)
    ) {
      throw new SourceCreditAdapterError("finding-source-binding-mismatch");
    }
    if (
      doc.audience.level !== "project-members" &&
      (finding.export_state !== "approved-for-export" ||
        NOT_REDISTRIBUTABLE.has(paper.rights.redistribution))
    ) {
      throw new SourceCreditAdapterError("source-audience-exceeds-finding-rights");
    }
    const passages = sortedStrings(b.passage_ids).map((id) => {
      const passage = packet.passages.find((p) => p.passage_id === id);
      if (!passage || passage.paper_id !== b.paper_id) {
        throw new SourceCreditAdapterError("passage-source-binding-mismatch");
      }
      return { passageId: id, quoteSha256: passage.quote_sha256, quoteState: passage.quote_state };
    });
    const snapshotSha256 = naToNull(b.source_snapshot_sha256);
    const target: SourceCreditTarget = {
      kind: "source-finding",
      sourceId: b.finding_id,
      sourceVersion: String(b.finding_revision),
      bindingSha256: snapshotSha256,
      packetId: doc.packet.packet_id,
      packetManifestSha256: manifestDigest,
      lineageSha256: null,
    };
    const doi = naToNull(paper.identifiers.doi);
    draft.evidence.push({
      observationId: tupleId("diggypaper", "evidence", [b.finding_id, b.finding_revision]),
      target,
      nativeBinding: "diggypaper-credit-entry",
      sourcePaperId: b.paper_id,
      findingOrigin: b.finding_origin,
      sourceSnapshotRef: b.source_snapshot_ref,
      sourceSnapshotSha256: snapshotSha256,
      phase2FindingSha256: null,
      citedWork: {
        doi,
        doiIsExample: doi !== null && isExampleDoi(doi),
        citeKey: null,
        authors: paper.authors,
        authorsAre: "bibliographic-citation-metadata",
      },
      nativeOrigin: {
        originId: doc.packet.packet_id,
        visibility: manifest.access_scope.level,
        disclosure: null,
      },
      mapping: null,
      sourceRights: {
        kind: "diggypaper-paper-rights",
        license: paper.rights.license,
        redistribution: paper.rights.redistribution,
        fullTextIncluded: paper.rights.full_text_included,
        packetLicenses,
      },
      passages,
      assessmentProtocol: b.assessment_protocol,
      // Packet reviewer refs are deliberately not carried: the companion may
      // withhold the very assessor the packet names by pseudonym.
      sourceAssessments: assessments
        .map((a) => ({
          assessmentId: a.assessment_id,
          protocol: a.protocol,
          status: a.status,
          curatorRef: null,
          assessedSnapshotSha256: naToNull(a.assessed_snapshot_sha256),
        }))
        .sort((x, y) => (x.assessmentId < y.assessmentId ? -1 : 1)),
      oratlasAdjudication: "none",
    });

    const reviewerOf = new Map(assessments.map((a) => [a.assessment_id, a.reviewer_ref]));
    const productionNames = new Set(entry.production.map((p) => p.name.trim().toLowerCase()));
    for (const contribution of entry.contributions) {
      checkContribution(contribution, b.assessment_ids, reviewerOf, productionNames);
      const person = personFromSource(contribution);
      const consentRef = naToNull(contribution.disclosure.consent_ref);
      if (contribution.status === "confirmed" && consentRef === null) {
        draft.report.reasonCodes.push("source-confirmed-without-decision-ref");
      }
      const base: Omit<SourceCreditAssertionV2, "observationId" | "role"> = {
        target,
        sourceAssertionId: contribution.contribution_id,
        person,
        capacity: contribution.capacity,
        sourceStatus: contribution.status,
        sourceDecisionRef: consentRef,
        sourceDeclarationKind: null,
        sourceAssertedAt: null,
        sourceDisclosure: {
          kind: "diggypaper-contribution",
          personConsent: contribution.disclosure.person_consent,
          controllerAuthorization: contribution.disclosure.controller_authorization,
          membership: contribution.disclosure.membership,
          consentRef,
          reviewBlinding: contribution.review_blinding,
        },
        sourceAudience: doc.audience.level,
        destinationStatus: "not-adjudicated",
        oratlasDisclosure: "not-authorized",
        assessmentIds: sortedStrings(contribution.assessment_ids),
      };
      const roles = contribution.credit_roles.length ? contribution.credit_roles : [null];
      for (const declared of roles) {
        const mapped = declared ? mapCreditRole(declared.role) : null;
        if (declared && !mapped) {
          draft.report.unmappable++;
          draft.report.reasonCodes.push("unmapped-credit-role");
        }
        if (person.kind === "withheld") draft.report.withheld++;
        draft.assertions.push({
          ...base,
          observationId: tupleId("diggypaper", "credit", [
            contribution.contribution_id,
            declared?.role ?? null,
          ]),
          role:
            mapped && declared
              ? {
                  slug: mapped,
                  originalLabel: declared.role,
                  degree: declared.degree === "not-available" ? null : declared.degree,
                  declarationRef: declared.declaration_ref,
                  roleUri: null,
                }
              : null,
        });
      }
    }
    const productionIds = entry.production.map((item) =>
      tupleId("diggypaper", "production", [
        b.finding_id,
        b.finding_revision,
        item.agent_type,
        item.name,
        item.version,
        item.activity,
        item.run_ref,
      ]),
    );
    uniqueOrThrow(productionIds, "duplicate-production-record");
    entry.production.forEach((item, index) => {
      draft.production.push({
        observationId: productionIds[index]!,
        target,
        softwareName: item.name,
        softwareVersion: item.version,
        softwareProducer: null,
        agentType: item.agent_type,
        sourceAgentId: null,
        runRef: naToNull(item.run_ref),
        activity: item.activity,
        legacyAuthorId: null,
        creditChannel: "production",
        actorKind: "software",
      });
    });
  }
  return finishDraft(draft);
}
