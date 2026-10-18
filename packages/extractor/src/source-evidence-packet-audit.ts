import { createHash } from "node:crypto";

/**
 * Audit-time resolution of an externally hosted Diggypaper `source-evidence-packet/0.1.0` against
 * the producer-finding links a review's sidecar declares (issue #198, MVP Gate G4).
 *
 * This is verification tooling for CI, fixtures and reviewers who hold a copy of the packet. It is
 * never called during ingestion or by any public route: ORAtlas does not import the packet and does
 * not claim to have verified it. It checks integrity and binding only; it does not re-run the
 * producer's full contract validator and says nothing about scientific support. Quote text is
 * deliberately not returned.
 */
export const SUPPORTED_PACKET_SCHEMA = "source-evidence-packet/0.1.0";
const PACKET_ARTIFACTS = ["papers", "findings", "passages", "assessments"] as const;

export type PacketFiles = Readonly<Record<string, string>>;

export interface PacketLinkClaim {
  findingId: string;
  packetId: string;
  /** Hex SHA-256 of the packet's `manifest.json` bytes, as declared by the sidecar. */
  packetSha256: string;
  /** Hex SHA-256 of the cited article's source snapshot, as declared by the sidecar. */
  sourceSha256: string;
  doi: string | null;
  /** Passage-level declaration from a `comprev.evidence-packet-links/2` sidecar, when present. */
  declared?: {
    revision: number;
    verificationLevel: string;
    passages: Array<{
      passageId: string;
      quoteSha256: string;
      quoteState: string;
      matchStatus: string;
    }>;
    assessments: Array<{ assessmentId: string; protocol: string; status: string }>;
  };
}

export const PACKET_AUDIT_CODES = [
  "manifest-invalid",
  "unsupported-schema-version",
  "packet-id-mismatch",
  "packet-digest-mismatch",
  "artifact-missing",
  "artifact-hash-mismatch",
  "artifact-length-mismatch",
  "record-count-mismatch",
  "artifact-invalid-json",
  "packet-not-public",
  "finding-not-in-packet",
  "finding-not-approved",
  "paper-not-in-packet",
  "snapshot-not-captured",
  "source-sha-mismatch",
  "doi-mismatch",
  "passage-not-in-packet",
  "passage-paper-mismatch",
  "quote-hash-mismatch",
  "restricted-quote-leak",
  "assessment-snapshot-mismatch",
  "finding-superseded",
  "verification-level-mismatch",
  "passage-set-mismatch",
  "passage-declaration-mismatch",
  "assessment-set-mismatch",
] as const;
export type PacketAuditCode = (typeof PACKET_AUDIT_CODES)[number];

export interface PacketAuditIssue {
  code: PacketAuditCode;
  findingId?: string;
  detail: string;
}

export interface PacketLineagePassage {
  passageId: string;
  quoteState: string;
  quoteSha256: string;
  matchStatus: string;
  snapshotRef: string;
  start: number | null;
  end: number | null;
}

export interface PacketLineageAssessment {
  assessmentId: string;
  protocol: string;
  status: string;
  reviewerRef: string;
  passageId: string;
  assessedSnapshotSha256: string;
}

export interface PacketLineage {
  findingId: string;
  revision: number;
  origin: string;
  exportState: string;
  reviewState: string;
  verificationLevel: string;
  paperId: string;
  doi: string;
  snapshotRef: string;
  /** Tagged `sha256:` form, as written in the packet. */
  snapshotSha256: string;
  passages: PacketLineagePassage[];
  assessments: PacketLineageAssessment[];
}

export interface PacketAuditResult {
  ok: boolean;
  issues: PacketAuditIssue[];
  /** One entry per link whose binding resolved without issue. */
  lineage: PacketLineage[];
}

type Rec = Record<string, unknown>;

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value, "utf8").digest("hex");
const asRec = (value: unknown): Rec => (value && typeof value === "object" ? (value as Rec) : {});
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const stripTag = (value: string): string => value.replace(/^sha256:/u, "");
const normalizeDoi = (doi: string): string =>
  doi
    .trim()
    .replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/iu, "")
    .toLowerCase();

function readJsonl(text: string): Rec[] | undefined {
  try {
    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => asRec(JSON.parse(line)));
  } catch {
    return undefined;
  }
}

export function auditSourceEvidencePacket(
  files: PacketFiles,
  links: readonly PacketLinkClaim[],
): PacketAuditResult {
  const issues: PacketAuditIssue[] = [];
  const add = (code: PacketAuditCode, detail: string, findingId?: string): void => {
    issues.push({ code, detail, ...(findingId ? { findingId } : {}) });
  };

  const manifestText = files["manifest.json"];
  let manifest: Rec = {};
  try {
    if (manifestText === undefined) throw new Error("missing");
    manifest = asRec(JSON.parse(manifestText));
  } catch {
    add("manifest-invalid", "manifest.json is missing or not valid JSON.");
    return { ok: false, issues, lineage: [] };
  }
  if (manifest.schema_version !== SUPPORTED_PACKET_SCHEMA) {
    add(
      "unsupported-schema-version",
      `Unsupported packet schema '${str(manifest.schema_version)}'.`,
    );
    return { ok: false, issues, lineage: [] };
  }
  const manifestDigest = sha256Hex(manifestText);
  const packetId = str(manifest.packet_id);
  for (const link of links) {
    if (link.packetSha256 !== manifestDigest) {
      add(
        "packet-digest-mismatch",
        "The packet's manifest digest differs from the declared digest.",
        link.findingId,
      );
    }
    if (link.packetId !== packetId) {
      add(
        "packet-id-mismatch",
        `Packet id '${packetId}' differs from declared '${link.packetId}'.`,
        link.findingId,
      );
    }
  }

  const declared = asRec(manifest.artifacts);
  const records: Record<(typeof PACKET_ARTIFACTS)[number], Rec[]> = {
    papers: [],
    findings: [],
    passages: [],
    assessments: [],
  };
  for (const name of PACKET_ARTIFACTS) {
    const entry = asRec(declared[name]);
    const path = str(entry.path);
    const text = files[path];
    if (text === undefined) {
      add("artifact-missing", `Declared artifact '${path || name}' is absent.`);
      continue;
    }
    if (sha256Hex(text) !== stripTag(str(entry.sha256))) {
      add("artifact-hash-mismatch", `Artifact '${path}' differs from its manifest digest.`);
    }
    if (Buffer.byteLength(text, "utf8") !== entry.bytes) {
      add("artifact-length-mismatch", `Artifact '${path}' differs from its manifest length.`);
    }
    const parsed = readJsonl(text);
    if (!parsed) {
      add("artifact-invalid-json", `Artifact '${path}' is not valid JSONL.`);
      continue;
    }
    if (parsed.length !== entry.record_count) {
      add(
        "record-count-mismatch",
        `Artifact '${path}' has ${parsed.length} records, not ${String(entry.record_count)}.`,
      );
    }
    records[name] = parsed;
  }
  if (asRec(manifest.access_scope).level !== "public") {
    add("packet-not-public", "The packet's access scope is not public.");
  }

  const lineage: PacketLineage[] = [];
  for (const link of links) {
    const before = issues.length;
    const revisions = records.findings
      .filter((finding) => finding.finding_id === link.findingId)
      .sort((a, b) => Number(b.revision) - Number(a.revision));
    // A declared revision is audited exactly; a later revision makes the declaration stale.
    const finding = link.declared
      ? revisions.find((candidate) => candidate.revision === link.declared!.revision)
      : revisions[0];
    if (finding && revisions[0] !== finding) {
      add(
        "finding-superseded",
        `A later revision of '${link.findingId}' exists in the packet.`,
        link.findingId,
      );
    }
    if (!finding) {
      add(
        "finding-not-in-packet",
        `Finding '${link.findingId}' is not in the packet.`,
        link.findingId,
      );
      continue;
    }
    if (
      finding.export_state !== "approved-for-export" ||
      finding.review_state !== "human-reviewed"
    ) {
      add(
        "finding-not-approved",
        "The finding is not an approved, human-reviewed export.",
        link.findingId,
      );
    }
    const paper = records.papers.find((candidate) => candidate.paper_id === finding.paper_id);
    if (!paper) {
      add(
        "paper-not-in-packet",
        `Paper '${str(finding.paper_id)}' is not in the packet.`,
        link.findingId,
      );
      continue;
    }
    const snapshot = asRec(paper.source_snapshot);
    if (snapshot.state !== "captured") {
      add(
        "snapshot-not-captured",
        "The cited article has no captured source snapshot.",
        link.findingId,
      );
    } else if (stripTag(str(snapshot.sha256)) !== link.sourceSha256) {
      add(
        "source-sha-mismatch",
        "The packet's snapshot digest differs from the declared source digest.",
        link.findingId,
      );
    }
    const paperDoi = str(asRec(paper.identifiers).doi);
    if (link.doi !== null && normalizeDoi(paperDoi) !== normalizeDoi(link.doi)) {
      add(
        "doi-mismatch",
        "The packet article's DOI differs from the declared DOI.",
        link.findingId,
      );
    }

    const passageIds = Array.isArray(finding.passage_ids) ? finding.passage_ids.map(str) : [];
    const passages: PacketLineagePassage[] = [];
    for (const passageId of passageIds) {
      const passage = records.passages.find((candidate) => candidate.passage_id === passageId);
      if (!passage) {
        add(
          "passage-not-in-packet",
          `Passage '${passageId}' is not in the packet.`,
          link.findingId,
        );
        continue;
      }
      if (passage.paper_id !== finding.paper_id) {
        add(
          "passage-paper-mismatch",
          `Passage '${passageId}' belongs to another article.`,
          link.findingId,
        );
      }
      const included = passage.quote_state === "included";
      if (included && sha256Hex(str(passage.quote)) !== stripTag(str(passage.quote_sha256))) {
        add(
          "quote-hash-mismatch",
          `Passage '${passageId}' does not match its quote digest.`,
          link.findingId,
        );
      }
      if (included && asRec(paper.rights).redistribution !== "allowed") {
        add(
          "restricted-quote-leak",
          `Passage '${passageId}' includes a quote the article's rights do not allow.`,
          link.findingId,
        );
      }
      const source = asRec(passage.source);
      passages.push({
        passageId,
        quoteState: str(passage.quote_state),
        quoteSha256: str(passage.quote_sha256),
        matchStatus: str(asRec(passage.match).status),
        snapshotRef: str(source.snapshot_ref),
        start: typeof source.start === "number" ? source.start : null,
        end: typeof source.end === "number" ? source.end : null,
      });
    }

    const assessments: PacketLineageAssessment[] = [];
    for (const assessment of records.assessments) {
      if (
        assessment.finding_id !== link.findingId ||
        assessment.finding_revision !== finding.revision
      ) {
        continue;
      }
      if (str(assessment.assessed_snapshot_sha256) !== str(snapshot.sha256)) {
        add(
          "assessment-snapshot-mismatch",
          `Assessment '${str(assessment.assessment_id)}' judged a different snapshot.`,
          link.findingId,
        );
      }
      assessments.push({
        assessmentId: str(assessment.assessment_id),
        protocol: str(assessment.protocol),
        status: str(assessment.status),
        reviewerRef: str(assessment.reviewer_ref),
        passageId: str(assessment.passage_id),
        assessedSnapshotSha256: str(assessment.assessed_snapshot_sha256),
      });
    }

    if (link.declared) {
      const declared = link.declared;
      if (str(finding.verification_level) !== declared.verificationLevel) {
        add(
          "verification-level-mismatch",
          "The packet's verification level differs from the declaration.",
          link.findingId,
        );
      }
      const actualIds = passages
        .map((passage) => passage.passageId)
        .sort()
        .join("\0");
      const declaredIds = declared.passages
        .map((passage) => passage.passageId)
        .sort()
        .join("\0");
      if (actualIds !== declaredIds) {
        add(
          "passage-set-mismatch",
          "The packet's passages for this finding differ from the declared set.",
          link.findingId,
        );
      }
      for (const claimed of declared.passages) {
        const actual = passages.find((passage) => passage.passageId === claimed.passageId);
        if (
          actual &&
          (actual.quoteSha256 !== claimed.quoteSha256 ||
            actual.quoteState !== claimed.quoteState ||
            actual.matchStatus !== claimed.matchStatus)
        ) {
          add(
            "passage-declaration-mismatch",
            `Passage '${claimed.passageId}' differs from its declared digest or match state.`,
            link.findingId,
          );
        }
      }
      const key = (items: Array<{ id: string; status: string }>) =>
        items
          .map((item) => `${item.id}=${item.status}`)
          .sort()
          .join("\0");
      if (
        key(assessments.map((a) => ({ id: a.assessmentId, status: a.status }))) !==
        key(declared.assessments.map((a) => ({ id: a.assessmentId, status: a.status })))
      ) {
        add(
          "assessment-set-mismatch",
          "The packet's native assessments differ from the declared set.",
          link.findingId,
        );
      }
    }

    if (issues.length === before) {
      lineage.push({
        findingId: link.findingId,
        revision: Number(finding.revision),
        origin: str(finding.origin),
        exportState: str(finding.export_state),
        reviewState: str(finding.review_state),
        verificationLevel: str(finding.verification_level),
        paperId: str(paper.paper_id),
        doi: paperDoi,
        snapshotRef: str(snapshot.snapshot_ref),
        snapshotSha256: str(snapshot.sha256),
        passages,
        assessments: assessments.sort((a, b) => (a.assessmentId < b.assessmentId ? -1 : 1)),
      });
    }
  }
  return { ok: issues.length === 0, issues, lineage };
}
