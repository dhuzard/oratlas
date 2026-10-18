import { z } from "zod";
import {
  CREDIT_ROLE_LABELS,
  type SourceCreditObservations,
  type SourceCreditTarget,
  type SourceCreditPerson,
} from "@oratlas/contracts";
import {
  SourceCreditAdapterError,
  digest,
  finishDraft,
  parseNative,
  parseSource,
  shaSchema,
  startDraft,
  uniqueOrThrow,
} from "./source-credit-adapter-shared.js";

const disclosure = z.object({ public: z.boolean(), approval_ids: z.array(z.string()) });
const subject = z.object({
  review_id: z.string().min(1), version: z.string().min(1), claim_graph_sha256: shaSchema,
});
const crtSchema = z.object({
  schema: z.literal("comprev.contributorship/1"),
  visibility: z.literal("private"),
  subject,
  contributors: z.array(z.object({
    id: z.string().min(1),
    kind: z.literal("person"),
    display_name: z.string().min(1),
    orcid: z.union([z.null(), z.object({
      id: z.string().min(1),
      status: z.enum(["claimed", "verified"]),
      verification: z.object({
        method: z.enum(["orcid-oauth", "controller-check"]),
        ref: z.string().min(1),
        verified_at: z.string().min(1),
      }).optional(),
    })]),
    disclosure,
  })),
  credit_assertions: z.array(z.object({
    assertion_id: z.string().min(1),
    contributor: z.string().min(1),
    role: z.string().min(1),
    role_label: z.string().min(1),
    degree: z.enum(["lead", "equal", "supporting"]).nullable(),
    status: z.enum(["declared", "confirmed", "disputed", "withdrawn"]),
    status_ref: z.string().nullable(),
    source_kind: z.string().min(1),
    source_ref: z.string().min(1),
    target: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("review") }),
      z.object({ kind: z.literal("claim"), claim_id: z.string().min(1) }),
    ]),
  })),
  production: z.object({
    agent_runs: z.array(z.object({
      agent_id: z.string().min(1),
      kind: z.literal("software-agent"),
      name: z.string().min(1),
      version: z.string().nullable(),
      workflow_role: z.string().nullable(),
      credit_channel: z.literal("production"),
    })),
  }),
  source_origins: z.array(z.object({
    origin_id: z.string().min(1),
    packet_id: z.string().min(1),
    visibility: z.enum(["public", "private"]),
    disclosure,
  })),
  source_credit: z.array(z.object({
    claim_id: z.string().min(1),
    disclosure,
    findings: z.array(z.object({
      finding_id: z.string().min(1),
      finding_revision: z.number().int().positive(),
      phase2_finding_sha256: shaSchema,
      binding: z.literal("reviewed-mapping"),
      origin_id: z.string().min(1),
      decision_ref: z.string().min(1),
      lineage_sha256: shaSchema,
      packet: z.object({ packet_id: z.string().min(1), manifest_sha256: shaSchema }),
      cited_work: z.object({
        credit_kind: z.literal("bibliographic-citation"),
        authors: z.array(z.string()),
        doi: z.string().min(1),
      }),
      passages: z.array(z.object({ passage_id: z.string().min(1), quote_sha256: shaSchema })),
      source_assessments: z.array(z.object({
        assessment_id: z.string().min(1),
        protocol: z.string().min(1),
        curator_ref: z.string().min(1),
        curator_ref_kind: z.literal("source-native-pseudonym"),
      })),
      source_curation: z.object({
        credit_channel: z.literal("source-native"),
        review_authorship: z.literal(false),
      }),
    })),
  })),
  relation_proposals: z.array(z.object({
    relation_id: z.string().min(1), finding_refs: z.array(z.unknown()).min(2),
  })),
});

export function adaptCRTContributorship(
  raw: string,
  claimGraphRaw?: string,
): SourceCreditObservations {
  const doc = parseNative(crtSchema, parseSource(raw));
  if (claimGraphRaw !== undefined && digest(claimGraphRaw) !== doc.subject.claim_graph_sha256) {
    throw new SourceCreditAdapterError("claim-graph-sha256-mismatch");
  }
  const output = startDraft(
    "computational-review-template",
    doc.schema,
    "a19a8dc90ddbf93c06d6ab050aaad3a00d28a262",
    doc.subject.review_id + ":" + doc.subject.version,
    raw,
  );
  const reviewTarget: SourceCreditTarget = {
    kind: "review", sourceId: doc.subject.review_id,
    sourceVersion: doc.subject.version, bindingSha256: doc.subject.claim_graph_sha256,
    packetId: null, packetManifestSha256: null, lineageSha256: null,
  };

  uniqueOrThrow(doc.contributors.map((c) => c.id), "duplicate-crt-contributor");
  uniqueOrThrow(doc.credit_assertions.map((c) => c.assertion_id), "duplicate-crt-assertion");
  uniqueOrThrow(doc.source_origins.map((o) => o.origin_id), "duplicate-crt-origin");
  const contributors = new Map(doc.contributors.map((c) => [c.id, c]));
  const origins = new Map(doc.source_origins.map((o) => [o.origin_id, o]));
  const seenFindings = new Map<string, string>();

  for (const declaration of doc.credit_assertions) {
    const contributor = contributors.get(declaration.contributor);
    if (!contributor) throw new SourceCreditAdapterError("crt-dangling-contributor");
    if (
      (declaration.status !== "declared" && !declaration.status_ref) ||
      (declaration.status === "declared" && declaration.status_ref !== null)
    ) throw new SourceCreditAdapterError("crt-status-decision-invalid");

    const verified = contributor.orcid?.status === "verified";
    if (verified && (!contributor.orcid?.verification?.ref || !contributor.orcid.verification.verified_at)) {
      throw new SourceCreditAdapterError("crt-orcid-evidence-missing");
    }
    const person: SourceCreditPerson = {
      kind: "named", sourcePersonId: contributor.id, displayName: contributor.display_name,
      orcid: contributor.orcid?.id ?? null,
      sourceOrcidStatus: verified ? "source-verified" : contributor.orcid ? "claimed" : "absent",
      verificationRef: verified ? contributor.orcid?.verification?.ref ?? null : null,
    };
    const mapped = Object.keys(CREDIT_ROLE_LABELS).includes(declaration.role);
    if (!mapped) {
      output.report.unmappable++;
      output.report.reasonCodes.push("unmapped-credit-role");
    }
    const target: SourceCreditTarget = declaration.target.kind === "review"
      ? reviewTarget
      : {
          ...reviewTarget,
          kind: "review-claim",
          sourceId: declaration.target.claim_id,
        };
    if (!contributor.disclosure.public) output.report.withheld++;
    output.assertions.push({
      observationId: "crt:credit:" + declaration.assertion_id,
      target, person, capacity: declaration.target.kind === "review" ? "review-contributor" : "claim-contributor",
      role: mapped
        ? {
            slug: declaration.role as keyof typeof CREDIT_ROLE_LABELS,
            originalLabel: declaration.role_label,
            degree: declaration.degree,
            declarationRef: declaration.source_ref,
          }
        : null,
      sourceStatus: declaration.status, sourceDecisionRef: declaration.status_ref,
      destinationStatus: "not-adjudicated", sourceAudience: "crt-private-companion",
      oratlasDisclosure: "not-authorized",
      disclosureBasis: [
        "source-disclosure:" + String(contributor.disclosure.public),
        "origin:" + declaration.source_kind,
      ],
      assessmentIds: [],
    });
  }

  for (const record of doc.source_credit) {
    for (const entry of record.findings) {
      const origin = origins.get(entry.origin_id);
      if (!origin || origin.packet_id !== entry.packet.packet_id) {
        throw new SourceCreditAdapterError("crt-origin-binding-invalid");
      }
      const key = entry.finding_id + ":" + entry.finding_revision;
      const earlierPacket = seenFindings.get(key);
      if (earlierPacket !== undefined && earlierPacket !== entry.packet.packet_id) {
        throw new SourceCreditAdapterError("crt-duplicate-finding");
      }
      seenFindings.set(key, entry.packet.packet_id);
      const target: SourceCreditTarget = {
        kind: "source-finding",
        sourceId: entry.finding_id, sourceVersion: String(entry.finding_revision),
        bindingSha256: entry.phase2_finding_sha256,
        packetId: entry.packet.packet_id,
        packetManifestSha256: entry.packet.manifest_sha256,
        lineageSha256: entry.lineage_sha256,
      };
      output.evidence.push({
        observationId: "crt:evidence:" + record.claim_id + ":" + key,
        target, sourcePaperId: null, sourceSnapshotSha256: null,
        phase2FindingSha256: entry.phase2_finding_sha256,
        passageIds: entry.passages.map((p) => p.passage_id),
        quoteSha256: entry.passages.map((p) => p.quote_sha256),
        assessmentIds: entry.source_assessments.map((a) => a.assessment_id),
        originalPaperAuthors: entry.cited_work.authors,
        sourceStatus: "reviewed-mapping:" + record.claim_id + ":" + entry.decision_ref,
        oratlasAdjudication: "none",
      });
      if (origin.visibility === "private" || !record.disclosure.public) output.report.withheld++;
    }
  }

  uniqueOrThrow(doc.production.agent_runs.map((a) => a.agent_id), "crt-duplicate-software");
  for (const agent of doc.production.agent_runs) {
    output.production.push({
      observationId: "crt:software:" + agent.agent_id,
      target: reviewTarget,
      softwareName: agent.name,
      softwareVersion: agent.version,
      runId: agent.agent_id,
      activity: agent.workflow_role ?? "not-declared",
      actorKind: "software",
    });
  }
  // Existing CRT relation_proposals remain source-native proposals, not
  // confirmed ORAtlas claim→finding or cross-project edges.
  if (doc.relation_proposals.length) {
    output.report.unmappable += doc.relation_proposals.length;
    output.report.reasonCodes.push("crt-relation-proposals-not-authoritative");
  }
  if (claimGraphRaw === undefined) output.report.reasonCodes.push("claim-graph-bytes-not-supplied");
  return finishDraft(output);
}
