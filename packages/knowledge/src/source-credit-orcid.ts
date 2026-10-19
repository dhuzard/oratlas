import { z } from "zod";
import {
  isChecksumValidOrcid,
  isExampleDoi,
  type SourceCreditObservationsV2,
} from "@oratlas/contracts";
import {
  SourceCreditAdapterError,
  finishDraft,
  mapCreditRole,
  parseNative,
  parseSource,
  sortedStrings,
  startDraft,
  tupleId,
  uniqueOrThrow,
  verifyRosterdigest,
} from "./source-credit-adapter-shared.js";

/**
 * Offline, private ONLY. Mirrors the frozen roster schema and the
 * privacy/consent rules of ORCID Playground `roster.validate_export` at the
 * pinned commit. Members are candidate contacts and contributions are credit
 * claims to review: nothing here is an account, grant, invitation or
 * confirmed contribution.
 */
const key = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const dateTime = z.string().datetime({ offset: true });
const assertion = z
  .object({
    basis: z.enum(["public-orcid-record", "owner-curated", "external-verified"]),
    method: z.string().min(1).max(200),
    asserted_at: dateTime,
    asserted_by: key.nullable(),
    evidence: z
      .object({
        source_record_version: z.string().min(1).max(200).nullable(),
        reference: z.string().min(1).max(500).nullable(),
      })
      .strict(),
  })
  .strict();
type Assertion = z.infer<typeof assertion>;
const MEMBER_FIELDS = ["orcid", "display_name", "local_role"] as const;

const rosterSchema = z
  .object({
    schema: z.literal("orcid-playground/roster-assertion"),
    schema_version: z.literal("0.1.0"),
    export_id: key,
    generated_at: dateTime,
    origin: z.enum(["local-offline-roster", "external-platform"]),
    distribution: z.literal("private-recipient-only"),
    access_effect: z
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
        scope: z.literal("roster-export"),
        method: z.literal("local-explicit-opt-in"),
        granted_at: dateTime,
        granted_by: key,
        revoked_at: dateTime.nullable(),
      })
      .strict(),
    redaction: z
      .object({
        policy: z.literal("default-private"),
        member_fields: z
          .array(z.enum(MEMBER_FIELDS))
          .refine((values) => new Set(values).size === values.length),
        private_members: z.literal("omitted"),
        excluded_outputs: z.array(z.enum(["unsupported-source-rights", "not-selected"])).max(10),
        project_references: z.enum(["omitted", "included"]),
      })
      .strict(),
    group: z
      .object({
        local_id: key,
        name: z.string().min(1).max(300),
        created_by: key,
        assertion,
      })
      .strict(),
    members: z
      .array(
        z
          .object({
            member_key: key,
            display_name: z.string().min(1).max(300).nullable(),
            orcid: z
              .object({
                id: z.string().regex(/^[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$/u),
                uri: z
                  .string()
                  .regex(
                    /^https:\/\/(sandbox\.)?orcid\.org\/[0-9]{4}-[0-9]{4}-[0-9]{4}-[0-9]{3}[0-9X]$/u,
                  ),
                status: z.enum(["claimed", "oauth-verified"]),
                assertion,
              })
              .strict()
              .nullable(),
            local_role: z.string().min(1).max(200).nullable(),
            membership: z
              .object({
                status: z.enum([
                  "listed-member",
                  "verified-invitation-accepted",
                  "active-member-per-source",
                ]),
                assertion,
              })
              .strict(),
            person_assertion: assertion,
          })
          .strict(),
      )
      .max(500),
    outputs: z
      .array(
        z
          .object({
            output_key: key,
            title: z.string().max(1000).nullable(),
            identifiers: z
              .object({
                doi: z
                  .string()
                  .regex(/^10\.[0-9]{4,9}\/\S+$/u)
                  .max(500)
                  .optional(),
              })
              .strict(),
            source_rights: z.enum(["public-orcid-record", "owner-provided"]),
            assertion,
          })
          .strict(),
      )
      .max(2000),
    contributions: z
      .array(
        z
          .object({
            member_key: key,
            output_key: key,
            credit_role: z.enum([
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
            ]),
            status: z.enum(["source-declared", "curator-confirmed"]),
            assertion,
          })
          .strict(),
      )
      .max(5000),
    project_references: z
      .array(
        z
          .object({
            provider: z.string().min(1).max(100),
            identifier: z.string().min(1).max(300),
            status: z.literal("proposed"),
            declared_visibility: z.enum(["public", "private"]),
            sharing_approved: z.boolean(),
            url: z.string().url().startsWith("https://").nullable(),
            assertion,
          })
          .strict(),
      )
      .max(50),
    digest: z
      .object({ algorithm: z.literal("sha256"), value: z.string().regex(/^[0-9a-f]{64}$/u) })
      .strict(),
  })
  .strict();
type Roster = z.infer<typeof rosterSchema>;

const assertionV2 = (value: Assertion) => ({
  basis: value.basis,
  method: value.method,
  assertedAt: value.asserted_at,
  assertedBy: value.asserted_by,
  evidence: {
    sourceRecordVersion: value.evidence.source_record_version,
    reference: value.evidence.reference,
  },
});

const externallyEvidenced = (value: Assertion) =>
  value.basis === "external-verified" && value.evidence.reference !== null;

/** Frozen `validate_export` rules that bear on identity, consent and privacy. */
function checkRoster(doc: Roster): void {
  const fail = (code: string): never => {
    throw new SourceCreditAdapterError(code);
  };
  if (doc.consent.granted_by !== doc.group.created_by) fail("roster-consent-invalid");
  if (doc.consent.status === "revoked") {
    if (doc.consent.revoked_at === null) fail("roster-consent-invalid");
    // Project references are content too: a revocation never lets them survive.
    if (
      doc.members.length ||
      doc.outputs.length ||
      doc.contributions.length ||
      doc.project_references.length
    ) {
      fail("roster-revoked-data-present");
    }
  } else if (doc.consent.revoked_at !== null) {
    fail("roster-consent-invalid");
  }
  const shared = new Set<string>(doc.redaction.member_fields);
  uniqueOrThrow(
    doc.members.map((m) => m.member_key),
    "duplicate-roster-member",
  );
  uniqueOrThrow(
    doc.members.flatMap((m) => (m.orcid ? [m.orcid.id] : [])),
    "duplicate-roster-orcid",
  );
  const local = doc.origin === "local-offline-roster";
  for (const member of doc.members) {
    for (const field of MEMBER_FIELDS) {
      if (!shared.has(field) && member[field] !== null) fail("roster-redaction-contradiction");
    }
    if (member.orcid) {
      const { id, uri, status } = member.orcid;
      if (
        !isChecksumValidOrcid(id) ||
        (uri !== `https://orcid.org/${id}` && uri !== `https://sandbox.orcid.org/${id}`)
      ) {
        fail("source-identity-invalid");
      }
      if (status === "oauth-verified") {
        if (local) fail("roster-elevated-identity-claim");
        if (!externallyEvidenced(member.orcid.assertion))
          fail("roster-verification-evidence-missing");
      }
    }
    if (member.membership.status !== "listed-member") {
      if (local) fail("roster-elevated-identity-claim");
      if (!externallyEvidenced(member.membership.assertion)) {
        fail("roster-verification-evidence-missing");
      }
    }
  }
  if (local) {
    const assertions = [
      doc.group.assertion,
      ...doc.members.flatMap((m) => [
        m.person_assertion,
        m.membership.assertion,
        ...(m.orcid ? [m.orcid.assertion] : []),
      ]),
      ...doc.outputs.map((o) => o.assertion),
      ...doc.contributions.map((c) => c.assertion),
      ...doc.project_references.map((p) => p.assertion),
    ];
    if (assertions.some((a) => a.basis === "external-verified")) {
      fail("roster-elevated-identity-claim");
    }
  }
  uniqueOrThrow(
    doc.outputs.map((o) => o.output_key),
    "duplicate-roster-output",
  );
  const members = new Set(doc.members.map((m) => m.member_key));
  const outputs = new Set(doc.outputs.map((o) => o.output_key));
  uniqueOrThrow(
    doc.contributions.map((c) => JSON.stringify([c.member_key, c.output_key, c.credit_role])),
    "duplicate-roster-contribution",
  );
  for (const credit of doc.contributions) {
    if (!members.has(credit.member_key) || !outputs.has(credit.output_key)) {
      fail("roster-contribution-reference-invalid");
    }
    if (
      (credit.status === "source-declared" && credit.assertion.evidence.reference === null) ||
      (credit.status === "curator-confirmed" && credit.assertion.asserted_by === null)
    ) {
      fail("roster-contribution-provenance-missing");
    }
  }
  if (doc.project_references.length && doc.redaction.project_references !== "included") {
    fail("roster-redaction-contradiction");
  }
  if (doc.project_references.some((p) => p.url !== null && !p.sharing_approved)) {
    fail("roster-redaction-contradiction");
  }
}

export function adaptOrcidRoster(raw: string): SourceCreditObservationsV2 {
  const data = parseSource(raw);
  const doc = parseNative(rosterSchema, data);
  verifyRosterdigest(data);
  checkRoster(doc);
  const output = startDraft("orcid-playground", doc.export_id, raw, {
    kind: "orcid-roster",
    exportId: doc.export_id,
    generatedAt: doc.generated_at,
    origin: doc.origin,
    distribution: doc.distribution,
    sourceAccessEffect: { ...doc.access_effect },
    consent: {
      status: doc.consent.status,
      scope: doc.consent.scope,
      method: doc.consent.method,
      grantedAt: doc.consent.granted_at,
      grantedBy: doc.consent.granted_by,
      revokedAt: doc.consent.revoked_at,
    },
    redaction: {
      policy: doc.redaction.policy,
      memberFields: sortedStrings(
        doc.redaction.member_fields,
      ) as Roster["redaction"]["member_fields"],
      privateMembers: doc.redaction.private_members,
      excludedOutputs: sortedStrings(doc.redaction.excluded_outputs),
      projectReferences: doc.redaction.project_references,
    },
    group: { localId: doc.group.local_id, createdBy: doc.group.created_by },
    digest: { algorithm: doc.digest.algorithm, value: doc.digest.value },
  });
  output.report.producerDeclaredOmissions = {
    state: null,
    counts: {},
    reasons: sortedStrings([
      ...new Set([
        ...doc.redaction.excluded_outputs.map((reason) => "excluded-output-reason:" + reason),
        "policy:private-members-omitted",
        ...(doc.redaction.project_references === "omitted"
          ? ["policy:project-references-omitted"]
          : []),
      ]),
    ]),
  };
  output.report.omittedSourceFields.push("orcid.group.name-and-assertion");
  if (doc.consent.status === "revoked") {
    output.report.reasonCodes.push("roster-consent-revoked");
    return finishDraft(output);
  }
  if (doc.outputs.some((o) => o.title !== null)) {
    output.report.omittedSourceFields.push("orcid.outputs.title");
  }
  const outputs = new Map(doc.outputs.map((o) => [o.output_key, o]));
  const claimed = new Set(doc.contributions.map((c) => c.output_key));
  if (doc.outputs.some((o) => !claimed.has(o.output_key))) {
    // An output is carried only through a credit claim; it is never a credit by itself.
    output.report.omittedSourceFields.push("orcid.outputs.without-credit-claims");
  }

  for (const member of doc.members) {
    output.candidateContacts.push({
      observationId: tupleId("orcid-playground", "contact", [member.member_key]),
      sourceMemberRef: member.member_key,
      displayName: member.display_name,
      localRole: member.local_role,
      orcid: member.orcid && {
        id: member.orcid.id,
        uri: member.orcid.uri,
        nativeStatus: member.orcid.status,
        assertion: assertionV2(member.orcid.assertion),
      },
      membership: {
        nativeStatus: member.membership.status,
        assertion: assertionV2(member.membership.assertion),
      },
      personAssertion: assertionV2(member.person_assertion),
      destinationStatus: "candidate-only",
      accessEffect: "none",
    });
  }
  for (const credit of doc.contributions) {
    const work = outputs.get(credit.output_key)!;
    const mapped = mapCreditRole(credit.credit_role);
    if (!mapped) {
      output.report.unmappable++;
      output.report.reasonCodes.push("unmapped-credit-role");
    }
    const doi = work.identifiers.doi ?? null;
    output.candidateCreditClaims.push({
      observationId: tupleId("orcid-playground", "credit-claim", [
        credit.member_key,
        credit.output_key,
        credit.credit_role,
      ]),
      sourceMemberRef: credit.member_key,
      output: {
        sourceOutputRef: credit.output_key,
        doi,
        doiIsExample: doi !== null && isExampleDoi(doi),
        sourceRights: work.source_rights,
        assertion: assertionV2(work.assertion),
      },
      role: mapped
        ? {
            slug: mapped,
            originalLabel: credit.credit_role,
            degree: null,
            declarationRef: credit.assertion.evidence.reference,
            roleUri: null,
          }
        : null,
      sourceStatus: credit.status, // even curator-confirmed is not ORAtlas confirmation
      assertion: assertionV2(credit.assertion),
      destinationStatus: "candidate-only",
      accessEffect: "none",
      confirmedByImport: false,
    });
  }
  if (doc.project_references.length > 0) {
    output.report.unmappable += doc.project_references.length;
    output.report.reasonCodes.push("proposed-projects-never-grant-access");
    output.report.omittedSourceFields.push("orcid.project-references");
  }
  return finishDraft(output);
}
