import { createHash } from "node:crypto";
import {
  SOURCE_EVIDENCE_LABELS,
  SOURCE_EVIDENCE_LINKS_SCHEMA_VERSION,
  canonicalJson,
  sidecarClaimSchema,
  sidecarEvidenceLinkSchema,
  sourceEvidenceLinksSchema,
  sourceNativeSidecarSchema,
  type SidecarEvidenceLink,
  type SidecarPacketLocator,
  type SourceEvidenceLinkRejectionReason,
  type SourceEvidenceLinkedFinding,
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
  /** Preserved text of `knowledge/trust_score_report.json`, when it was captured. */
  trustReportContent?: string;
}

type Rejected = SourceEvidenceLinks["rejected"][number];

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const normalizeDoi = (doi: string): string =>
  doi
    .trim()
    .replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu, "")
    .toLowerCase();
const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function emptyProjection(
  status: SourceEvidenceLinks["status"],
  sidecar: SourceEvidenceLinks["sidecar"],
  rejected: Rejected[] = [],
  nativeAssessmentWithheld: SourceEvidenceLinks["nativeAssessmentWithheld"] = null,
): SourceEvidenceLinks {
  return sourceEvidenceLinksSchema.parse({
    schemaVersion: SOURCE_EVIDENCE_LINKS_SCHEMA_VERSION,
    status,
    sidecar,
    packets: [],
    citations: [],
    rejected: sortRejected(rejected),
    nativeAssessment: null,
    nativeAssessmentWithheld,
    labels: SOURCE_EVIDENCE_LABELS,
  });
}

/**
 * The part of a link record that must agree for one finding as seen from one claim. The claim list
 * and other claims' mapping decisions are excluded; this claim's own decision is included.
 */
function claimScopedIdentity(link: SidecarEvidenceLink, claimId: string): string {
  const { linked_review_claim_ids: _claims, mappings, ...rest } = link;
  return canonicalJson({
    ...rest,
    mapping: mappings?.find((mapping) => mapping.claim_id === claimId) ?? null,
  });
}

/**
 * Project the preserved source-native sidecar onto one review claim.
 *
 * Deterministic and order-independent: the result depends only on the set of sidecar records, never
 * on their order, and conflicting records are rejected rather than resolved by position. It never
 * fetches the external packet and never asserts anything the sidecar does not carry. Only a reviewed
 * mapping makes a finding evidence for the claim; a shared DOI makes it a same-paper candidate.
 * Malformed input fails closed with a status, never an exception.
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
  // The exporter only ever writes objects into these arrays; anything else means the file is not a
  // faithful export, and no record in it can be trusted.
  if (
    !sidecar.data.evidence_links.every(isPlainObject) ||
    !sidecar.data.claims.every(isPlainObject)
  ) {
    return emptyProjection("sidecar-invalid", sidecarDescriptor);
  }

  const rejected: Rejected[] = [];
  const reject = (
    findingId: string | null,
    citeKey: string | null,
    reason: SourceEvidenceLinkRejectionReason,
  ): void => {
    rejected.push({ findingId, citeKey, reason });
  };
  const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

  // Every well-formed record, and the records attributed to this claim. A malformed record is
  // attributable only if it plainly names this claim.
  const allLinks: SidecarEvidenceLink[] = [];
  const candidates: SidecarEvidenceLink[] = [];
  for (const raw of sidecar.data.evidence_links as Array<Record<string, unknown>>) {
    const parsed = sidecarEvidenceLinkSchema.safeParse(raw);
    if (parsed.success) {
      allLinks.push(parsed.data);
      if (parsed.data.linked_review_claim_ids.includes(input.claimLocalId)) {
        candidates.push(parsed.data);
      }
      continue;
    }
    const named = raw.linked_review_claim_ids;
    if (Array.isArray(named) && named.includes(input.claimLocalId)) {
      reject(text(raw.finding_id), text(raw.cite_key), "invalid-link-record");
    }
  }

  // This claim's record. Identical duplicates collapse; differing ones cannot be chosen between.
  const claimRecords = (sidecar.data.claims as Array<Record<string, unknown>>).filter(
    (claim) => claim.claim_id === input.claimLocalId,
  );
  if (new Set(claimRecords.map((claim) => canonicalJson(claim))).size > 1) {
    for (const link of candidates) reject(link.finding_id, link.cite_key, "claim-record-conflict");
    return emptyProjection("sidecar-invalid", sidecarDescriptor, rejected);
  }
  const claimParse = claimRecords[0] ? sidecarClaimSchema.safeParse(claimRecords[0]) : undefined;
  if (claimParse && !claimParse.success) {
    return emptyProjection("sidecar-invalid", sidecarDescriptor, rejected);
  }
  const claimRecord = claimParse?.data;

  // Digest binding: a sidecar exported for different claim text or a different claim graph is stale
  // for this version and must not present lineage or the native assessment.
  const sources = sidecar.data.sources;
  const graphDigest = sources.claim_graph?.sha256;
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
    return emptyProjection(
      "sidecar-stale",
      sidecarDescriptor,
      rejected,
      claimRecord?.trust_v2 ? "sidecar-stale" : null,
    );
  }
  if (!claimRecord) {
    for (const link of candidates) reject(link.finding_id, link.cite_key, "claim-not-in-sidecar");
    return emptyProjection("no-producer-finding", sidecarDescriptor, rejected);
  }

  // Ambiguity. For this claim, every record of one finding must declare the same thing (citation,
  // digests, revision, verification, passages, judgments, binding and this claim's decision). Across
  // the whole sidecar, one packet id must have one digest and one locator.
  const ambiguous = new Set<SidecarEvidenceLink>();
  const byFinding = new Map<string, SidecarEvidenceLink[]>();
  for (const link of candidates) {
    byFinding.set(link.finding_id, [...(byFinding.get(link.finding_id) ?? []), link]);
  }
  for (const group of byFinding.values()) {
    const identities = new Set(group.map((link) => claimScopedIdentity(link, input.claimLocalId)));
    if (identities.size > 1) for (const link of group) ambiguous.add(link);
  }
  const packetIdentity = new Map<string, Set<string>>();
  for (const link of allLinks) {
    const identity = canonicalJson({
      sha256: link.packet_sha256,
      locator: link.packet_locator ?? null,
    });
    packetIdentity.set(
      link.packet_id,
      new Set([...(packetIdentity.get(link.packet_id) ?? []), identity]),
    );
  }
  for (const link of candidates) {
    if ((packetIdentity.get(link.packet_id)?.size ?? 0) > 1) ambiguous.add(link);
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
    // Diggypaper links are DOI-based: a link must name a DOI and the review's citation must agree.
    if (link.doi === null || citation.doi === null) {
      reject(link.finding_id, link.cite_key, "doi-unconfirmed");
      continue;
    }
    if (normalizeDoi(link.doi) !== normalizeDoi(citation.doi)) {
      reject(link.finding_id, link.cite_key, "doi-mismatch");
      continue;
    }
    // Only identical declarations reach this point, so which copy is kept cannot matter.
    accepted.set(link.finding_id, { link, citation });
  }

  const present = (link: SidecarEvidenceLink): SourceEvidenceLinkedFinding => {
    const mapping =
      link.binding === "reviewed-mapping"
        ? (link.mappings?.find((entry) => entry.claim_id === input.claimLocalId) ?? null)
        : null;
    return {
      findingId: link.finding_id,
      binding: link.binding ?? "binding-not-declared",
      phase2FindingSha256: link.phase2_finding_sha256 ?? null,
      mapping: mapping
        ? {
            decisionRef: mapping.decision_ref,
            assertedAt: mapping.asserted_at,
            basis: mapping.basis,
          }
        : null,
      producer: link.producer,
      packetId: link.packet_id,
      sourceSnapshotSha256: link.finding_source_sha256,
      revision: link.finding_revision ?? null,
      verificationLevel: link.verification_level ?? null,
      passageEvidence: link.passages ? "declared-by-sidecar" : "not-carried-by-sidecar",
      passages: link.passages
        ? link.passages
            .map((passage) => ({
              passageId: passage.passage_id,
              quoteSha256: passage.quote_sha256,
              quoteState: passage.quote_state,
              matchStatus: passage.match_status,
            }))
            .sort((a, b) => compareText(a.passageId, b.passageId))
        : null,
      producerAssessment: link.assessments ? "declared-by-sidecar" : "not-carried-by-sidecar",
      assessments: link.assessments
        ? link.assessments
            .map((assessment) => ({
              assessmentId: assessment.assessment_id,
              protocol: assessment.protocol,
              status: assessment.status,
            }))
            .sort((a, b) => compareText(a.assessmentId, b.assessmentId))
        : null,
    };
  };

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
      const relation = input.relations
        .filter((candidate) => candidate.citationLocalId === citationLocalId)
        .sort((a, b) => compareText(a.relationType, b.relationType))[0]!;
      const findings = entries
        .map(({ link }) => present(link))
        .sort((a, b) => compareText(a.findingId, b.findingId));
      return {
        citationLocalId,
        doi: citation.doi,
        doiIsExample: citation.doiIsExample,
        relation: { relationType: relation.relationType, sourceLocation: relation.sourceLocation },
        findings: findings.filter((finding) => finding.binding === "reviewed-mapping"),
        candidateFindings: findings.filter((finding) => finding.binding !== "reviewed-mapping"),
      };
    });

  const packets = new Map<string, { sha256: string; locator: SidecarPacketLocator | null }>();
  for (const { link } of accepted.values()) {
    packets.set(link.packet_id, {
      sha256: link.packet_sha256,
      locator: link.packet_locator ?? null,
    });
  }

  // Native assessment provenance: recheck the recorded digests of the frozen native sources where
  // their bytes were preserved. A mismatch withholds the value; an absence is labelled, not hidden.
  const sourceCheck = (
    declared: string | undefined,
    content: string | undefined,
  ): "digest-matched" | "not-preserved" | "not-declared" | "mismatch" =>
    declared === undefined
      ? "not-declared"
      : content === undefined
        ? "not-preserved"
        : declared === sha256Hex(content)
          ? "digest-matched"
          : "mismatch";
  const graphCheck = sourceCheck(graphDigest, input.claimGraphContent);
  const reportCheck = sourceCheck(sources.trust_score_report?.sha256, input.trustReportContent);
  const trust = claimRecord.trust_v2;
  // A graph mismatch already returned as stale above, so only the report can mismatch here.
  const nativeWithheld = Boolean(trust) && reportCheck === "mismatch";

  const reviewed = citations.some((citation) => citation.findings.length > 0);
  return sourceEvidenceLinksSchema.parse({
    schemaVersion: SOURCE_EVIDENCE_LINKS_SCHEMA_VERSION,
    status: reviewed ? "linked" : citations.length > 0 ? "candidates-only" : "no-producer-finding",
    sidecar: sidecarDescriptor,
    packets: [...packets.entries()]
      .sort(([a], [b]) => compareText(a, b))
      .map(([packetId, { sha256: packetSha256, locator }]) => ({
        packetId,
        producer: "diggypaper",
        packetSha256,
        locator: presentLocator(locator),
        availability: locator ? "locator-declared" : "location-not-declared",
        contentsImportedByOratlas: false,
        contentsVerifiedByOratlas: false,
      })),
    citations,
    rejected: sortRejected(rejected),
    nativeAssessment:
      trust && !nativeWithheld
        ? {
            protocol: "computational-review-trust",
            rubricVersion: trust.rubric_version,
            origin: "source-native",
            label: trust.trust_label,
            nativeOverallScore: trust.overall_score,
            capped: trust.capped,
            reAdjudicatedByOratlas: false,
            isOratlasAssessment: false,
            provenance: { claimGraph: graphCheck, trustScoreReport: reportCheck },
            verifiedAgainstPreservedSources:
              graphCheck === "digest-matched" && reportCheck === "digest-matched",
          }
        : null,
    nativeAssessmentWithheld: nativeWithheld ? "trust-report-digest-mismatch" : null,
    labels: SOURCE_EVIDENCE_LABELS,
  });
}

/** Example DOIs (10.5555/…) are never offered as outbound links. */
function presentLocator(locator: SidecarPacketLocator | null) {
  if (!locator) return null;
  if (locator.kind === "doi") {
    const doiIsExample = /^10\.5555\//i.test(locator.doi);
    return {
      kind: "doi" as const,
      doi: locator.doi,
      url: null,
      href: doiIsExample ? null : `https://doi.org/${locator.doi}`,
      doiIsExample,
    };
  }
  return {
    kind: "github-release-asset" as const,
    doi: null,
    url: locator.url,
    href: locator.url,
    doiIsExample: false,
  };
}

function sortRejected(rejected: Rejected[]): Rejected[] {
  return [...rejected].sort(
    (a, b) =>
      compareText(a.findingId ?? "", b.findingId ?? "") ||
      compareText(a.citeKey ?? "", b.citeKey ?? "") ||
      compareText(a.reason, b.reason),
  );
}
