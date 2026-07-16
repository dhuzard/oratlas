import { type z } from "zod";
import {
  citationRecordSchema,
  claimRecordSchema,
  isSafeRepoRelativePath,
  parseJsonlArtifact,
  relationRecordSchema,
  trustAssessmentRecordSchema,
  validateNodeManifest,
  type CitationRecord,
  type ClaimRecord,
  type InspectionReport,
  type RelationRecord,
  type ReviewManifest,
  type TrustAssessmentRecord,
} from "@oratlas/contracts";
import type { NodeExtractionReport } from "./nodes.js";

export interface ExtractedKnowledge {
  claims: ClaimRecord[];
  citations: CitationRecord[];
  relations: RelationRecord[];
  trust: TrustAssessmentRecord[];
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
  nodeExtraction?: NodeExtractionReport,
): ExtractedKnowledge {
  const warnings: string[] = [];

  const claimsPath = pickPath(report, manifest?.artifacts?.claims, ["claim"]);
  const citationsPath = pickPath(report, manifest?.artifacts?.citations, ["citation"]);
  const relationsPath = pickPath(report, manifest?.artifacts?.relations, ["relation"]);
  const declaredTrustPaths = [
    nodeManifestTrustPath(report),
    manifest?.artifacts?.trustAssessments,
  ].filter((path): path is string => Boolean(path));
  const trustPaths =
    declaredTrustPaths.length > 0
      ? [...new Set(declaredTrustPaths)]
      : [pickPath(report, undefined, ["trust"])].filter((path): path is string => Boolean(path));

  const claims = readJsonl(report, claimsPath, claimRecordSchema, warnings, "claims");
  const citations = readJsonl(report, citationsPath, citationRecordSchema, warnings, "citations");
  const relations = readJsonl(report, relationsPath, relationRecordSchema, warnings, "relations");
  const trust = trustPaths.flatMap((path) =>
    readJsonl(report, path, trustAssessmentRecordSchema, warnings, "trust"),
  );

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
    if ("subjectType" in t) {
      return validateNodeRelationTrustSubject(t, nodeExtraction, warnings);
    }
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

function nodeManifestTrustPath(report: InspectionReport): string | undefined {
  const content = report.files["node-manifest.json"]?.content;
  if (!content) return undefined;
  try {
    const validation = validateNodeManifest(JSON.parse(content));
    return validation.ok ? validation.manifest?.trustAssessments?.path : undefined;
  } catch {
    return undefined;
  }
}

function validateNodeRelationTrustSubject(
  record: Extract<TrustAssessmentRecord, { subjectType: "node-relation" }>,
  nodeExtraction: NodeExtractionReport | undefined,
  warnings: string[],
): boolean {
  if (!nodeExtraction) {
    warnings.push("Dropped node-relation TRUST record: node extraction context is unavailable.");
    return false;
  }
  const nodes = new Map(
    nodeExtraction.nodes
      .filter((entry) => entry.status === "ok" && entry.node)
      .map((entry) => [entry.node!.id, entry.node!]),
  );
  const claim = nodes.get(record.subject.claimNodeId);
  if (!claim || claim.kind !== "claim") {
    warnings.push(
      `Dropped node-relation TRUST record ${record.subject.claimNodeId}→${record.subject.evidenceNodeId}: the claim node was not extracted exactly.`,
    );
    return false;
  }
  if (!record.subject.evidenceRepository) {
    const evidence = nodes.get(record.subject.evidenceNodeId);
    if (!evidence || evidence.kind !== record.subject.evidenceKind) {
      warnings.push(
        `Dropped node-relation TRUST record ${record.subject.claimNodeId}→${record.subject.evidenceNodeId}: the local evidence node kind does not match.`,
      );
      return false;
    }
  }
  const matches = nodeExtraction.edges.filter(
    (entry) =>
      entry.status === "ok" &&
      entry.edge?.sourceNodeId === record.subject.claimNodeId &&
      entry.edge.targetNodeId === record.subject.evidenceNodeId &&
      entry.edge.relationType === record.subject.relationType &&
      sameTargetRepository(entry.edge.targetRepository, record.subject.evidenceRepository),
  );
  if (matches.length !== 1) {
    warnings.push(
      `Dropped node-relation TRUST record ${record.subject.claimNodeId}→${record.subject.evidenceNodeId}: expected one exact author edge declaration, found ${matches.length}.`,
    );
    return false;
  }
  return true;
}

function sameTargetRepository(
  left: { githubRepositoryId: string; commitSha: string } | undefined,
  right: { githubRepositoryId: string; commitSha: string } | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.githubRepositoryId === right.githubRepositoryId && left.commitSha === right.commitSha;
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
