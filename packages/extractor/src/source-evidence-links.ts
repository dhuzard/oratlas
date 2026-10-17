import { createHash } from "node:crypto";
import {
  SOURCE_EVIDENCE_LABELS,
  SOURCE_EVIDENCE_LINKS_SCHEMA_VERSION,
  sidecarClaimSchema,
  sidecarEvidenceLinkSchema,
  sourceEvidenceLinksSchema,
  sourceNativeSidecarSchema,
  type SidecarEvidenceLink,
  type SourceEvidenceLinkRejectionReason,
  type SourceEvidenceLinks,
} from "@oratlas/contracts";

export interface SourceEvidenceCitationInput {
  localCitationId: string;
  doi: string | null;
  doiIsExample: boolean;
}

export interface SourceEvidenceRelationInput {
  citationLocalId: string;
  relationType: string;
  sourceLocation: string | null;
}

export interface ProjectSourceEvidenceLinksInput {
  claimLocalId: string;
  claimText: string;
  /** Preserved text of the declared `provenance` sidecar, if one was declared and preserved. */
  sidecar?: { path: string; content: string };
  /** Citations and claim→citation relations of the accepted review version. */
  citations: SourceEvidenceCitationInput[];
  relations: SourceEvidenceRelationInput[];
  /** Preserved text of `knowledge/claim_graph.json`, when it was captured. */
  claimGraphContent?: string;
}

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const normalizeDoi = (doi: string): string =>
  doi
    .trim()
    .replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu, "")
    .toLowerCase();

function emptyProjection(
  status: SourceEvidenceLinks["status"],
  sidecar: SourceEvidenceLinks["sidecar"],
  rejected: SourceEvidenceLinks["rejected"] = [],
): SourceEvidenceLinks {
  return sourceEvidenceLinksSchema.parse({
    schemaVersion: SOURCE_EVIDENCE_LINKS_SCHEMA_VERSION,
    status,
    sidecar,
    packets: [],
    citations: [],
    rejected,
    nativeAssessment: null,
    labels: SOURCE_EVIDENCE_LABELS,
  });
}

/**
 * Project the preserved source-native sidecar onto one review claim.
 *
 * Deterministic and order-independent: the result depends only on the set of sidecar records, never
 * on their order. It never fetches the external packet and never asserts anything the sidecar does
 * not carry. A link that cannot be bound unambiguously to one of this review's own citations and
 * claim→citation relations is reported under `rejected`, never silently dropped and never shown as
 * lineage.
 */
export function projectSourceEvidenceLinks(
  input: ProjectSourceEvidenceLinksInput,
): SourceEvidenceLinks {
  if (!input.sidecar) return emptyProjection("sidecar-unavailable", null);
  const sidecarDescriptor = {
    path: input.sidecar.path,
    sha256: sha256Hex(input.sidecar.content),
    bytes: Buffer.byteLength(input.sidecar.content, "utf8"),
  };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.sidecar.content);
  } catch {
    return emptyProjection("sidecar-invalid", sidecarDescriptor);
  }
  const sidecar = sourceNativeSidecarSchema.safeParse(parsedJson);
  if (!sidecar.success) return emptyProjection("sidecar-invalid", sidecarDescriptor);

  const rejected: SourceEvidenceLinks["rejected"] = [];
  const reject = (
    findingId: string | null,
    citeKey: string | null,
    reason: SourceEvidenceLinkRejectionReason,
  ): void => {
    rejected.push({ findingId, citeKey, reason });
  };

  // Candidate records attributed to this claim. A record that fails the schema is attributable only
  // if it plainly names this claim; otherwise it is not this claim's to report.
  const candidates: SidecarEvidenceLink[] = [];
  for (const raw of sidecar.data.evidence_links) {
    const parsed = sidecarEvidenceLinkSchema.safeParse(raw);
    if (parsed.success) {
      if (parsed.data.linked_review_claim_ids.includes(input.claimLocalId)) {
        candidates.push(parsed.data);
      }
      continue;
    }
    const loose = raw as {
      linked_review_claim_ids?: unknown;
      finding_id?: unknown;
      cite_key?: unknown;
    };
    if (
      Array.isArray(loose.linked_review_claim_ids) &&
      loose.linked_review_claim_ids.includes(input.claimLocalId)
    ) {
      reject(
        typeof loose.finding_id === "string" ? loose.finding_id : null,
        typeof loose.cite_key === "string" ? loose.cite_key : null,
        "invalid-link-record",
      );
    }
  }

  // Digest binding: a sidecar exported for different claim text or a different claim graph is stale
  // for this version and must not present lineage.
  const claimRecord = sidecar.data.claims
    .map((claim) => sidecarClaimSchema.safeParse(claim))
    .flatMap((result) => (result.success ? [result.data] : []))
    .find((claim) => claim.claim_id === input.claimLocalId);
  const graphDigest = sidecar.data.sources.claim_graph?.sha256;
  const staleReason: SourceEvidenceLinkRejectionReason | undefined =
    claimRecord && claimRecord.claim_text_sha256 !== sha256Hex(input.claimText)
      ? "claim-text-digest-mismatch"
      : graphDigest !== undefined &&
          input.claimGraphContent !== undefined &&
          graphDigest !== sha256Hex(input.claimGraphContent)
        ? "claim-graph-digest-mismatch"
        : undefined;
  if (staleReason) {
    for (const link of candidates) reject(link.finding_id, link.cite_key, staleReason);
    return emptyProjection("sidecar-stale", sidecarDescriptor, sortRejected(rejected));
  }
  if (!claimRecord) {
    for (const link of candidates) reject(link.finding_id, link.cite_key, "claim-not-in-sidecar");
    return emptyProjection("no-producer-finding", sidecarDescriptor, sortRejected(rejected));
  }

  // Ambiguity: one finding bound to several citations, snapshots or packets; or one packet id with
  // several digests. None of these is resolved by choosing; all participants are rejected.
  const ambiguous = new Set<SidecarEvidenceLink>();
  const byFinding = new Map<string, SidecarEvidenceLink[]>();
  const byPacket = new Map<string, SidecarEvidenceLink[]>();
  for (const link of candidates) {
    byFinding.set(link.finding_id, [...(byFinding.get(link.finding_id) ?? []), link]);
    byPacket.set(link.packet_id, [...(byPacket.get(link.packet_id) ?? []), link]);
  }
  for (const group of byFinding.values()) {
    const identities = new Set(
      group.map((link) =>
        [link.cite_key, link.finding_source_sha256, link.packet_id, link.packet_sha256].join("\0"),
      ),
    );
    if (identities.size > 1) for (const link of group) ambiguous.add(link);
  }
  for (const group of byPacket.values()) {
    if (new Set(group.map((link) => link.packet_sha256)).size > 1) {
      for (const link of group) ambiguous.add(link);
    }
  }

  const citationsById = new Map<string, SourceEvidenceCitationInput[]>();
  for (const citation of input.citations) {
    citationsById.set(citation.localCitationId, [
      ...(citationsById.get(citation.localCitationId) ?? []),
      citation,
    ]);
  }

  type Accepted = { link: SidecarEvidenceLink; citation: SourceEvidenceCitationInput };
  const accepted = new Map<string, Accepted>();
  for (const link of candidates) {
    if (ambiguous.has(link)) {
      reject(link.finding_id, link.cite_key, "ambiguous-source-relationship");
      continue;
    }
    const matches = citationsById.get(link.cite_key) ?? [];
    if (matches.length === 0) {
      reject(link.finding_id, link.cite_key, "citation-not-in-review");
      continue;
    }
    if (matches.length > 1) {
      reject(link.finding_id, link.cite_key, "ambiguous-source-relationship");
      continue;
    }
    const citation = matches[0]!;
    if (
      !input.relations.some((relation) => relation.citationLocalId === citation.localCitationId)
    ) {
      reject(link.finding_id, link.cite_key, "no-citation-relation");
      continue;
    }
    if (link.doi !== null) {
      if (citation.doi === null) {
        reject(link.finding_id, link.cite_key, "doi-unconfirmed");
        continue;
      }
      if (normalizeDoi(link.doi) !== normalizeDoi(citation.doi)) {
        reject(link.finding_id, link.cite_key, "doi-mismatch");
        continue;
      }
    }
    // Identical duplicate records collapse; conflicting ones were rejected above.
    accepted.set(`${link.finding_id}\0${link.cite_key}`, { link, citation });
  }

  const byCitation = new Map<string, Accepted[]>();
  for (const entry of accepted.values()) {
    byCitation.set(entry.citation.localCitationId, [
      ...(byCitation.get(entry.citation.localCitationId) ?? []),
      entry,
    ]);
  }
  const citations = [...byCitation.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([citationLocalId, entries]) => {
      const citation = entries[0]!.citation;
      const relations = input.relations
        .filter((relation) => relation.citationLocalId === citationLocalId)
        .sort((a, b) => compareText(a.relationType, b.relationType));
      const relation = relations[0]!;
      return {
        citationLocalId,
        doi: citation.doi,
        doiIsExample: citation.doiIsExample,
        relation: { relationType: relation.relationType, sourceLocation: relation.sourceLocation },
        findings: entries
          .map(({ link }) => ({
            findingId: link.finding_id,
            producer: link.producer,
            packetId: link.packet_id,
            sourceSnapshotSha256: link.finding_source_sha256,
            passageEvidence: "not-carried-by-sidecar" as const,
            producerAssessment: "not-carried-by-sidecar" as const,
          }))
          .sort((a, b) => compareText(a.findingId, b.findingId)),
      };
    });

  const packets = new Map<string, string>();
  for (const { link } of accepted.values()) packets.set(link.packet_id, link.packet_sha256);

  const trust = claimRecord.trust_v2;
  return sourceEvidenceLinksSchema.parse({
    schemaVersion: SOURCE_EVIDENCE_LINKS_SCHEMA_VERSION,
    status: citations.length > 0 ? "linked" : "no-producer-finding",
    sidecar: sidecarDescriptor,
    packets: [...packets.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([packetId, packetSha256]) => ({
        packetId,
        producer: "diggypaper",
        packetSha256,
        availability: "location-not-declared",
        contentsImportedByOratlas: false,
        contentsVerifiedByOratlas: false,
      })),
    citations,
    rejected: sortRejected(rejected),
    nativeAssessment: trust
      ? {
          protocol: "computational-review-trust",
          rubricVersion: trust.rubric_version,
          origin: "source-native",
          label: trust.trust_label,
          nativeOverallScore: trust.overall_score,
          capped: trust.capped,
          reAdjudicatedByOratlas: false,
          isOratlasAssessment: false,
        }
      : null,
    labels: SOURCE_EVIDENCE_LABELS,
  });
}

function sortRejected(rejected: SourceEvidenceLinks["rejected"]): SourceEvidenceLinks["rejected"] {
  return [...rejected].sort(
    (a, b) =>
      compareText(a.findingId ?? "", b.findingId ?? "") ||
      compareText(a.citeKey ?? "", b.citeKey ?? "") ||
      compareText(a.reason, b.reason),
  );
}
