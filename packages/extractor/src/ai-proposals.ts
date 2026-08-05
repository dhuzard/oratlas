import { createHash } from "node:crypto";
import {
  ingestionExtractionPacketSchema,
  ingestionExtractionProposalSchema,
  type IngestionExtractionPacket,
  type IngestionExtractionProposal,
  type InspectionReport,
} from "@oratlas/contracts";

const MAX_FILES = 12;
const MAX_FILE_BYTES = 50_000;
const MAX_TOTAL_BYTES = 120_000;
const TEXT_PATH = /\.(?:md|mdx|txt|rst|tex|bib|yaml|yml|json)$/i;

/** Build a deterministic, commit-pinned text packet; it performs no provider call. */
export function buildIngestionExtractionPacket(
  report: InspectionReport,
): IngestionExtractionPacket {
  if (!report.selectedSource) throw new Error("AI extraction requires an exact inspected source.");
  const warnings: string[] = [];
  const files: IngestionExtractionPacket["files"] = [];
  let totalBytes = 0;
  for (const file of Object.values(report.files).sort((a, b) => a.path.localeCompare(b.path))) {
    if (!TEXT_PATH.test(file.path) || !file.content || file.truncated) continue;
    const byteLength = Buffer.byteLength(file.content, "utf8");
    if (byteLength === 0 || byteLength > MAX_FILE_BYTES) {
      warnings.push(`Skipped ${file.path}: outside the 1–${MAX_FILE_BYTES} byte bound.`);
      continue;
    }
    if (files.length >= MAX_FILES || totalBytes + byteLength > MAX_TOTAL_BYTES) {
      warnings.push(`Skipped ${file.path}: extraction packet budget reached.`);
      continue;
    }
    files.push({
      path: file.path,
      sha256: sha256(file.content),
      byteLength,
      content: file.content,
    });
    totalBytes += byteLength;
  }
  if (files.length === 0) {
    throw new Error("AI extraction requires at least one eligible, non-truncated text file.");
  }
  return ingestionExtractionPacketSchema.parse({
    schemaVersion: "1.0.0",
    repositoryUrl: report.repo.canonicalUrl,
    commitSha: report.selectedSource.commitSha,
    treeSha: report.selectedSource.treeSha,
    files,
    warnings: [...report.warnings, ...warnings].slice(0, 50),
  });
}

export interface ExtractionProposalValidation {
  ok: boolean;
  proposal?: IngestionExtractionProposal;
  issues: string[];
}

/** Verify exact UTF-8 byte spans and all proposal references before human review. */
export function validateIngestionExtractionProposal(
  value: unknown,
  packet: IngestionExtractionPacket,
): ExtractionProposalValidation {
  const parsedPacket = ingestionExtractionPacketSchema.parse(packet);
  const parsed = ingestionExtractionProposalSchema.safeParse(value);
  if (!parsed.success)
    return { ok: false, issues: parsed.error.issues.map((issue) => issue.message) };
  const issues: string[] = [];
  const fileByPath = new Map<string, IngestionExtractionPacket["files"][number]>();
  for (const file of parsedPacket.files) {
    if (fileByPath.has(file.path)) issues.push(`duplicate packet file path ${file.path}`);
    fileByPath.set(file.path, file);
    const bytes = Buffer.from(file.content, "utf8");
    if (bytes.length !== file.byteLength) issues.push(`packet byte length mismatch ${file.path}`);
    if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) {
      issues.push(`packet file hash mismatch ${file.path}`);
    }
  }
  const claimIds = uniqueIds(
    parsed.data.claims.map((claim) => claim.proposalId),
    "claim",
    issues,
  );
  const citationIds = uniqueIds(
    parsed.data.citations.map((citation) => citation.proposalId),
    "citation",
    issues,
  );
  for (const claim of parsed.data.claims) verifySpan(claim.source, fileByPath, issues);
  for (const citation of parsed.data.citations) {
    const excerpt = verifySpan(citation.source, fileByPath, issues);
    if (excerpt !== undefined && excerpt !== citation.rawCitationText) {
      issues.push(`citation ${citation.proposalId}: raw citation is not the exact source span`);
    }
  }
  const relationKeys = new Set<string>();
  for (const relation of parsed.data.relations) {
    if (!claimIds.has(relation.claimProposalId))
      issues.push("relation references an unknown claim");
    if (!citationIds.has(relation.citationProposalId))
      issues.push("relation references an unknown citation");
    const key = `${relation.claimProposalId}\u0000${relation.citationProposalId}\u0000${relation.relationType}`;
    if (relationKeys.has(key)) issues.push("duplicate extraction relation");
    relationKeys.add(key);
  }
  return issues.length ? { ok: false, issues } : { ok: true, proposal: parsed.data, issues: [] };
}

function verifySpan(
  span: { path: string; startByte: number; endByte: number; excerptSha256: string },
  files: Map<string, IngestionExtractionPacket["files"][number]>,
  issues: string[],
): string | undefined {
  const file = files.get(span.path);
  if (!file) {
    issues.push(`unknown source file ${span.path}`);
    return undefined;
  }
  const bytes = Buffer.from(file.content, "utf8");
  if (span.endByte <= span.startByte || span.endByte > bytes.length) {
    issues.push(`invalid source span ${span.path}:${span.startByte}-${span.endByte}`);
    return undefined;
  }
  const excerptBytes = bytes.subarray(span.startByte, span.endByte);
  if (createHash("sha256").update(excerptBytes).digest("hex") !== span.excerptSha256) {
    issues.push(`source span hash mismatch ${span.path}:${span.startByte}-${span.endByte}`);
    return undefined;
  }
  const excerpt = excerptBytes.toString("utf8");
  if (Buffer.from(excerpt, "utf8").length !== excerptBytes.length) {
    issues.push(`source span cuts through invalid UTF-8 boundaries in ${span.path}`);
    return undefined;
  }
  return excerpt;
}

function uniqueIds(values: string[], label: string, issues: string[]): Set<string> {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value)) issues.push(`duplicate ${label} proposal id ${value}`);
    ids.add(value);
  }
  return ids;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
