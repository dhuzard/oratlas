import { z } from "zod";
import { CREDIT_ROLE_LABELS, type SourceCreditObservations } from "@oratlas/contracts";
import {
  SourceCreditAdapterError,
  finishDraft,
  parseNative,
  parseSource,
  startDraft,
  uniqueOrThrow,
  verifyRosterdigest,
} from "./source-credit-adapter-shared.js";

const claim = z.object({
  basis: z.enum(["public-orcid-record", "owner-curated", "external-verified"]),
  method: z.string().min(1),
});
const rosterSchema = z.object({
  schema: z.literal("orcid-playground/roster-assertion"),
  schema_version: z.literal("0.1.0"),
  export_id: z.string().min(1),
  origin: z.enum(["local-offline-roster", "external-platform"]),
  distribution: z.literal("private-recipient-only"),
  access_effect: z.object({
    grants: z.literal("none"),
    invitations: z.literal("none"),
    accounts: z.literal("none"),
    authorship: z.literal("not-implied"),
    credit: z.literal("not-inferred"),
  }),
  consent: z.object({ status: z.enum(["granted", "revoked"]) }),
  redaction: z.object({ private_members: z.literal("omitted") }),
  members: z.array(
    z.object({
      member_key: z.string().min(1),
      display_name: z.string().nullable(),
      local_role: z.string().nullable(),
      orcid: z.union([
        z.null(),
        z.object({
          id: z.string().min(1),
          status: z.enum(["claimed", "oauth-verified"]),
          assertion: claim,
        }),
      ]),
      membership: z.object({
        status: z.enum([
          "listed-member",
          "verified-invitation-accepted",
          "active-member-per-source",
        ]),
        assertion: claim,
      }),
      person_assertion: claim,
    }),
  ),
  outputs: z.array(
    z.object({
      output_key: z.string().min(1),
      identifiers: z.object({ doi: z.string().optional() }),
    }),
  ),
  contributions: z.array(
    z.object({
      member_key: z.string().min(1),
      output_key: z.string().min(1),
      credit_role: z.string().min(1),
      status: z.enum(["source-declared", "curator-confirmed"]),
      assertion: claim,
    }),
  ),
  project_references: z.array(
    z.object({
      provider: z.string(),
      identifier: z.string(),
      status: z.literal("proposed"),
      sharing_approved: z.boolean(),
    }),
  ),
  digest: z.object({
    algorithm: z.literal("sha256"),
    value: z.string().regex(/^[0-9a-f]{64}$/u),
  }),
});

export function adaptOrcidRoster(raw: string): SourceCreditObservations {
  const doc = parseNative(rosterSchema, parseSource(raw));
  verifyRosterdigest(parseSource(raw));
  const output = startDraft(
    "orcid-playground",
    doc.schema + "/" + doc.schema_version,
    "ff5aff93cb34620f3f2500f709259aa0134c24f2",
    doc.export_id,
    raw,
  );
  if (doc.consent.status !== "granted") {
    if (doc.members.length || doc.outputs.length || doc.contributions.length) {
      throw new SourceCreditAdapterError("roster-revoked-data-present");
    }
    output.report.reasonCodes.push("roster-consent-revoked");
    return finishDraft(output);
  }
  uniqueOrThrow(
    doc.members.map((member) => member.member_key),
    "duplicate-roster-member",
  );
  uniqueOrThrow(
    doc.outputs.map((work) => work.output_key),
    "duplicate-roster-output",
  );
  const members = new Map(doc.members.map((m) => [m.member_key, m]));
  const outputs = new Set(doc.outputs.map((w) => w.output_key));

  for (const member of doc.members) {
    if (
      doc.origin === "local-offline-roster" &&
      (member.membership.status !== "listed-member" ||
        member.orcid?.status === "oauth-verified" ||
        member.person_assertion.basis === "external-verified" ||
        member.membership.assertion.basis === "external-verified")
    )
      throw new SourceCreditAdapterError("roster-elevated-identity-claim");
    output.candidateContacts.push({
      observationId: "orcid:contact:" + member.member_key,
      sourceMemberRef: member.member_key,
      sourceOutputRef: null,
      orcid: member.orcid?.id ?? null,
      sourceRole: member.local_role,
      role: null,
      sourceStatus: member.membership.status,
      destinationStatus: "candidate-only",
      accessEffect: "none",
    });
  }
  uniqueOrThrow(
    doc.contributions.map((c) => c.member_key + ":" + c.output_key + ":" + c.credit_role),
    "duplicate-roster-contribution",
  );
  for (const credit of doc.contributions) {
    const member = members.get(credit.member_key);
    if (!member || !outputs.has(credit.output_key)) {
      throw new SourceCreditAdapterError("roster-contribution-reference-invalid");
    }
    const mapped = Object.keys(CREDIT_ROLE_LABELS).includes(credit.credit_role);
    if (!mapped) {
      output.report.unmappable++;
      output.report.reasonCodes.push("unmapped-credit-role");
    }
    output.candidateContacts.push({
      observationId:
        "orcid:assertion:" + credit.member_key + ":" + credit.output_key + ":" + credit.credit_role,
      sourceMemberRef: credit.member_key,
      sourceOutputRef: credit.output_key,
      orcid: member.orcid?.id ?? null,
      sourceRole: null, // a local team role is never a CRediT assertion
      role: mapped
        ? {
            slug: credit.credit_role as keyof typeof CREDIT_ROLE_LABELS,
            originalLabel: credit.credit_role,
            degree: null,
            declarationRef: credit.assertion.method,
          }
        : null,
      sourceStatus: credit.status, // even curator-confirmed is not ORAtlas confirmation
      destinationStatus: "candidate-only",
      accessEffect: "none",
    });
  }
  if (doc.project_references.length > 0) {
    output.report.unmappable += doc.project_references.length;
    output.report.reasonCodes.push("proposed-projects-never-grant-access");
  }
  return finishDraft(output);
}
