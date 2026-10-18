import { z } from "zod";
import {
  CREDIT_ROLE_LABELS,
  type SourceCreditPerson,
  type SourceCreditTarget,
  type SourceCreditObservations,
} from "@oratlas/contracts";
import {
  SourceCreditAdapterError,
  arrayEq,
  digest,
  finishDraft,
  isoOrNull,
  parseJsonl,
  parseNative,
  parseSource,
  shaSchema,
  startDraft,
  uniqueOrThrow,
} from "./source-credit-adapter-shared.js";

/**
 * Offline, private ONLY. Must be used after Diggypaper's own reference
 * validator. This additional binding check protects the importer against
 * treating a DOI, repeated finding ID, or stale revision as a new identity.
 */
export interface DiggypaperCreditPacket {
  manifest: string;
  papers: string;
  findings: string;
  passages: string;
  assessments: string;
}

const shaOrNA = z.union([shaSchema, z.literal("not-available")]);
const baseObj = z.object({
  schema_version: z.literal("finding-credit-companion/0.1.0"),
  companion_id: z.string().min(1),
  packet: z.object({
    schema_version: z.literal("source-evidence-packet/0.1.0"),
    packet_id: z.string().min(1),
    packet_digest: shaSchema,
  }),
  audience: z.object({ level: z.enum(["public", "project-members", "named-recipient"]) }),
  release: z.object({ state: z.enum(["controller-approved", "not-released"]) }),
  entries: z.array(
    z.object({
      entry_id: z.string().min(1),
      binding: z.object({
        packet_digest: shaSchema,
        finding_id: z.string().min(1),
        finding_revision: z.number().int().positive(),
        finding_origin: z.string().min(1),
        paper_id: z.string().min(1),
        source_snapshot_ref: z.string().min(1),
        source_snapshot_sha256: shaOrNA,
        passage_ids: z.array(z.string()),
        assessment_protocol: z.literal("seip-support-v1"),
        assessment_ids: z.array(z.string()),
      }),
      contributions: z.array(
        z.object({
          contribution_id: z.string().min(1),
          capacity: z.enum([
            "finding-proposer",
            "finding-curator",
            "support-assessor",
            "project-team",
          ]),
          status: z.enum([
            "source-declared",
            "self-declared",
            "confirmed",
            "withheld",
            "disputed",
            "withdrawn",
          ]),
          contributor: z.union([
            z.object({ kind: z.literal("pseudonym"), ref: z.string().min(1) }),
            z.object({ kind: z.literal("withheld") }),
            z.object({
              kind: z.literal("disclosed"),
              display_name: z.string().min(1),
              orcid: z.union([
                z.literal("not-available"),
                z.object({
                  id: z.string().min(1),
                  verification: z.enum(["oauth-verified", "claimed-unverified"]),
                  verification_ref: z.string().min(1),
                  verified_at: z.string().min(1),
                }),
              ]),
            }),
          ]),
          credit_roles: z.array(
            z.object({
              role: z.string().min(1),
              degree: z.enum(["lead", "equal", "supporting", "not-available"]),
              declaration_ref: z.string().min(1),
            }),
          ),
          assessment_ids: z.array(z.string()),
          review_blinding: z.enum(["blinded", "unblinded", "unknown", "not-applicable"]),
          disclosure: z.object({
            person_consent: z.string(),
            controller_authorization: z.string(),
            membership: z.string(),
            consent_ref: z.string(),
          }),
        }),
      ),
      production: z.array(
        z.object({
          agent_type: z.enum(["software", "ml-model"]),
          name: z.string().min(1),
          version: z.string().min(1),
          activity: z.string().min(1),
          run_ref: z.string().min(1),
        }),
      ),
    }),
  ),
});

const packetManifestSchema = z.object({
  packet_id: z.string(),
  schema_version: z.literal("source-evidence-packet/0.1.0"),
  artifacts: z.record(
    z.object({
      sha256: shaSchema,
      bytes: z.number().int().nonnegative(),
      record_count: z.number().int().nonnegative(),
    }),
  ),
});

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
  return { manifest, records, manifestDigest: digest(packet.manifest) };
}

const findRef = (values: Record<string, unknown>[], field: string, value: string) =>
  values.find((record) => record[field] === value);

function personFromSource(
  person: z.infer<typeof baseObj>["entries"][number]["contributions"][number]["contributor"],
  consent: {
    person_consent: string;
    controller_authorization: string;
    membership: string;
  },
  blinding: string,
  contributionId: string,
): SourceCreditPerson {
  if (person.kind === "withheld") return { kind: "withheld" };
  if (person.kind === "pseudonym") return { kind: "pseudonym", sourceRef: person.ref };
  if (
    blinding === "blinded" ||
    consent.person_consent !== "granted" ||
    consent.controller_authorization !== "granted" ||
    consent.membership !== "active"
  ) {
    throw new SourceCreditAdapterError("disclosure-not-authorized");
  }
  const sourceOrcid = person.orcid === "not-available" ? null : person.orcid;
  const sourceVerified = sourceOrcid?.verification === "oauth-verified";
  if (
    sourceOrcid?.verification === "oauth-verified" &&
    (sourceOrcid.verified_at === "not-available" ||
      sourceOrcid.verification_ref === "not-available")
  ) {
    throw new SourceCreditAdapterError("source-orcid-evidence-missing");
  }
  return {
    kind: "named",
    sourcePersonId: contributionId,
    displayName: person.display_name,
    orcid: sourceOrcid?.id ?? null,
    sourceOrcidStatus: sourceOrcid === null ? "absent" : sourceVerified ? "source-verified" : "claimed",
    verificationRef: sourceVerified ? sourceOrcid?.verification_ref ?? null : null,
  };
}

export function adaptDiggypaperCredit(
  raw: string,
  packetBytes: DiggypaperCreditPacket,
): SourceCreditObservations {
  const parsed = parseNative(baseObj, parseSource(raw));
  const { manifest, records, manifestDigest } = validatedPacket(packetBytes);
  if (
    manifest.packet_id !== parsed.packet.packet_id ||
    manifestDigest !== parsed.packet.packet_digest
  ) {
    throw new SourceCreditAdapterError("packet-manifest-binding-mismatch");
  }
  const draft = startDraft(
    "diggypaper",
    parsed.schema_version,
    "a34d18f752377b2a6df01555d1963b2a43c0dca9",
    parsed.companion_id,
    raw,
  );
  uniqueOrThrow(
    parsed.entries.map((entry) => entry.entry_id),
    "duplicate-credit-entry",
  );
  const assertionIds: string[] = [];
  const bindingIds: string[] = [];

  for (const entry of parsed.entries) {
    const b = entry.binding;
    const key = b.finding_id + ":" + b.finding_revision;
    bindingIds.push(key);
    const findings = records.findings ?? [];
    const paper = findRef(records.papers ?? [], "paper_id", b.paper_id);
    const finding = findings.find(
      (f) => f.finding_id === b.finding_id && f.revision === b.finding_revision,
    );
    const later = findings.some(
      (f) => f.finding_id === b.finding_id && Number(f.revision) > b.finding_revision,
    );
    if (b.packet_digest !== manifestDigest || !paper || !finding || later) {
      throw new SourceCreditAdapterError("finding-revision-or-packet-invalid");
    }
    const snapshot = paper.source_snapshot as Record<string, unknown> | undefined;
    const passageIds = finding.passage_ids as string[] | undefined;
    const assessments = (records.assessments ?? []).filter(
      (a) => a.finding_id === b.finding_id && a.finding_revision === b.finding_revision,
    );
    const assessmentIds = assessments.map((a) => String(a.assessment_id));
    if (
      finding.paper_id !== b.paper_id ||
      finding.origin !== b.finding_origin ||
      snapshot?.snapshot_ref !== b.source_snapshot_ref ||
      snapshot?.sha256 !== b.source_snapshot_sha256 ||
      !passageIds ||
      !arrayEq(passageIds, b.passage_ids) ||
      !arrayEq(assessmentIds, b.assessment_ids)
    ) {
      throw new SourceCreditAdapterError("finding-source-binding-mismatch");
    }
    const sourceSnapshotSha256 =
      b.source_snapshot_sha256 === "not-available" ? null : b.source_snapshot_sha256;
    const target: SourceCreditTarget = {
      kind: "source-finding",
      sourceId: b.finding_id,
      sourceVersion: String(b.finding_revision),
      bindingSha256: sourceSnapshotSha256,
      packetId: parsed.packet.packet_id,
      packetManifestSha256: manifestDigest,
      lineageSha256: null,
    };
    const quoteSha256 = b.passage_ids.map((id) => {
      const passage = findRef(records.passages ?? [], "passage_id", id);
      if (!passage || passage.paper_id !== b.paper_id || typeof passage.quote_sha256 !== "string") {
        throw new SourceCreditAdapterError("passage-source-binding-mismatch");
      }
      return passage.quote_sha256;
    });
    for (const a of assessments) {
      if (
        a.assessed_snapshot_sha256 !== sourceSnapshotSha256 &&
        a.assessed_snapshot_sha256 !== b.source_snapshot_sha256
      ) {
        throw new SourceCreditAdapterError("assessment-source-binding-mismatch");
      }
    }
    draft.evidence.push({
      observationId: "diggypaper:evidence:" + key,
      target,
      sourcePaperId: b.paper_id,
      nativeOriginId: parsed.packet.packet_id,
      nativeVisibility: parsed.audience.level,
      sourceRights: String(
        (paper.rights as Record<string, unknown> | undefined)?.redistribution ?? "unknown",
      ),
      citedWorkDoi:
        typeof (paper.identifiers as Record<string, unknown> | undefined)?.doi === "string" &&
        (paper.identifiers as Record<string, unknown>).doi !== "not-available"
          ? String((paper.identifiers as Record<string, unknown>).doi)
          : null,
      sourceSnapshotSha256,
      phase2FindingSha256: null,
      passageIds: b.passage_ids,
      quoteSha256,
      assessmentIds: b.assessment_ids,
      originalPaperAuthors: Array.isArray(paper.authors)
        ? paper.authors.filter((a): a is string => typeof a === "string")
        : [],
      sourceStatus: "source-native-seip-support",
      oratlasAdjudication: "none",
    });
    for (const contribution of entry.contributions) {
      assertionIds.push(contribution.contribution_id);
      const person = personFromSource(
        contribution.contributor,
        contribution.disclosure,
        contribution.review_blinding,
        contribution.contribution_id,
      );
      if (
        contribution.capacity === "support-assessor" &&
        !contribution.assessment_ids.every((id) => assessmentIds.includes(id))
      ) {
        throw new SourceCreditAdapterError("assessor-binding-mismatch");
      }
      const roles = contribution.credit_roles.length ? contribution.credit_roles : [null];
      for (let index = 0; index < roles.length; index++) {
        const declared = roles[index];
        const mapped = declared
          ? Object.entries(CREDIT_ROLE_LABELS).find(([, label]) => label === declared.role)
          : null;
        if (declared && !mapped) {
          draft.report.unmappable++;
          draft.report.reasonCodes.push("unmapped-credit-role");
        }
        if (person.kind === "withheld" || contribution.status === "withheld")
          draft.report.withheld++;
        draft.assertions.push({
          observationId:
            "diggypaper:credit:" +
            contribution.contribution_id +
            ":" +
            (declared ? digest(declared.role).slice(7, 23) : "capacity"),
          target,
          person,
          capacity: contribution.capacity,
          role:
            mapped && declared
              ? {
                  slug: mapped[0] as keyof typeof CREDIT_ROLE_LABELS,
                  originalLabel: declared.role,
                  degree: declared.degree === "not-available" ? null : declared.degree,
                  declarationRef: declared.declaration_ref,
                }
              : null,
          sourceStatus: contribution.status,
          sourceDecisionRef: isoOrNull(contribution.disclosure.consent_ref),
          destinationStatus: "not-adjudicated",
          sourceAudience: parsed.audience.level,
          oratlasDisclosure: "not-authorized",
          disclosureBasis: [
            "consent:" + contribution.disclosure.person_consent,
            "controller:" + contribution.disclosure.controller_authorization,
            "membership:" + contribution.disclosure.membership,
            "blinding:" + contribution.review_blinding,
            "release:" + parsed.release.state,
          ],
          assessmentIds: contribution.assessment_ids,
        });
      }
    }
    for (const [index, item] of entry.production.entries()) {
      draft.production.push({
        observationId: "diggypaper:software:" + key + ":" + index,
        target,
        softwareName: item.name,
        softwareVersion: item.version,
        runId: isoOrNull(item.run_ref),
        activity: item.activity,
        actorKind: "software",
      });
    }
  }
  uniqueOrThrow(bindingIds, "duplicate-finding-binding");
  uniqueOrThrow(assertionIds, "duplicate-source-credit-id");
  return finishDraft(draft);
}
