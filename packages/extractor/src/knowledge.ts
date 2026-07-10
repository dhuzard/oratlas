import { type z } from "zod";
import {
  citationRecordSchema,
  claimRecordSchema,
  isSafeRepoRelativePath,
  parseJsonlArtifact,
  relationRecordSchema,
  trustRecordSchema,
  type CitationRecord,
  type ClaimRecord,
  type InspectionReport,
  type RelationRecord,
  type ReviewManifest,
  type TrustRecord,
} from "@oratlas/contracts";

export interface ExtractedKnowledge {
  claims: ClaimRecord[];
  citations: CitationRecord[];
  relations: RelationRecord[];
  trust: TrustRecord[];
  warnings: string[];
}

/**
 * Ingest knowledge artifacts (claims/citations/relations/trust JSONL) from the
 * inspection report, guided by manifest artifact paths when present. All paths
 * are re-checked for safety even though the manifest schema already validated
 * them (defence in depth).
 */
export function extractKnowledge(
  report: InspectionReport,
  manifest?: ReviewManifest,
): ExtractedKnowledge {
  const warnings: string[] = [];

  const claimsPath = pickPath(report, manifest?.artifacts?.claims, ["claim"]);
  const citationsPath = pickPath(report, manifest?.artifacts?.citations, ["citation"]);
  const relationsPath = pickPath(report, manifest?.artifacts?.relations, ["relation"]);
  const trustPath = pickPath(report, manifest?.artifacts?.trustAssessments, ["trust"]);

  const claims = readJsonl(report, claimsPath, claimRecordSchema, warnings, "claims");
  const citations = readJsonl(report, citationsPath, citationRecordSchema, warnings, "citations");
  const relations = readJsonl(report, relationsPath, relationRecordSchema, warnings, "relations");
  const trust = readJsonl(report, trustPath, trustRecordSchema, warnings, "trust");

  // Referential integrity: drop relations pointing at unknown claims/citations.
  const claimIds = new Set(claims.map((c) => c.id));
  const citationIds = new Set(citations.map((c) => c.id));
  const validRelations = relations.filter((r) => {
    const ok = claimIds.has(r.claimId) && citationIds.has(r.citationId);
    if (!ok) {
      warnings.push(
        `Dropped relation ${r.claimId}→${r.citationId}: references an unknown claim or citation.`,
      );
    }
    return ok;
  });

  const validTrust = trust.filter((t) => {
    const ok = claimIds.has(t.claimId) && citationIds.has(t.citationId);
    if (!ok) {
      warnings.push(
        `Dropped TRUST record ${t.claimId}→${t.citationId}: references an unknown claim or citation.`,
      );
    }
    return ok;
  });

  return { claims, citations, relations: validRelations, trust: validTrust, warnings };
}

function pickPath(
  report: InspectionReport,
  manifestPath: string | undefined,
  keywords: string[],
): string | undefined {
  if (manifestPath && isSafeRepoRelativePath(manifestPath) && report.files[manifestPath]?.content) {
    return manifestPath;
  }
  // Fall back to a discovered file matching the keyword.
  for (const [path, file] of Object.entries(report.files)) {
    const lower = path.toLowerCase();
    if (file.content && lower.endsWith(".jsonl") && keywords.some((k) => lower.includes(k))) {
      return path;
    }
  }
  return undefined;
}

function readJsonl<S extends z.ZodTypeAny>(
  report: InspectionReport,
  path: string | undefined,
  schema: S,
  warnings: string[],
  label: string,
): z.infer<S>[] {
  if (!path) return [];
  const content = report.files[path]?.content;
  if (!content) return [];
  const result = parseJsonlArtifact(content, schema);
  if (result.errors.length > 0) {
    warnings.push(
      `${label}: ${result.errors.length} invalid line(s) skipped in ${path} (first: line ${result.errors[0]?.line}).`,
    );
  }
  if (result.truncated) warnings.push(`${label}: ${path} truncated at record cap.`);
  return result.records;
}
