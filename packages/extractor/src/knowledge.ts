import { type z } from "zod";
import {
  citationRecordSchema,
  claimRecordSchema,
  isSafeRepoRelativePath,
  parseJsonlArtifact,
  relationRecordSchema,
  trustAssessmentRecordSchema,
  validateNodeManifest,
  type ArtifactOutcome,
  type ArtifactOutcomeIssue,
  type ArtifactOutcomes,
  type ArtifactSourceOutcome,
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

export type KnowledgeArtifactOutcomes = Pick<
  ArtifactOutcomes,
  "claims" | "citations" | "relations" | "trust"
>;

export interface KnowledgeExtractionResult {
  knowledge: ExtractedKnowledge;
  artifactOutcomes: KnowledgeArtifactOutcomes;
}

interface SourceSpec {
  path: string;
  discovery: "declared" | "discovered";
}

interface MutableSourceOutcome {
  path: string;
  discovery: "declared" | "discovered";
  status: "loaded" | "skipped" | "invalid";
  loadedCount: number;
  skippedCount: number | null;
  issues: ArtifactOutcomeIssue[];
}

interface TaggedRecord<T> {
  value: T;
  source: MutableSourceOutcome;
}

/** Back-compatible convenience API; detailed outcomes are available from the companion API. */
export function extractKnowledge(
  report: InspectionReport,
  manifest?: ReviewManifest,
  nodeExtraction?: NodeExtractionReport,
): ExtractedKnowledge {
  return extractKnowledgeWithOutcomes(report, manifest, nodeExtraction).knowledge;
}

/** Extract knowledge and the immutable, per-artifact processing outcomes used by compatibility. */
export function extractKnowledgeWithOutcomes(
  report: InspectionReport,
  manifest?: ReviewManifest,
  nodeExtraction?: NodeExtractionReport,
): KnowledgeExtractionResult {
  const warnings: string[] = [];
  const claimsSource = resolveSource(report, manifest?.artifacts?.claims, ["claim"]);
  const citationsSource = resolveSource(report, manifest?.artifacts?.citations, ["citation"]);
  const relationsSource = resolveSource(report, manifest?.artifacts?.relations, ["relation"]);

  const trustSpecs = uniqueSources([
    ...nodeManifestTrustSources(report),
    ...(manifest?.artifacts?.trustAssessments
      ? [{ path: manifest.artifacts.trustAssessments, discovery: "declared" as const }]
      : []),
  ]);
  const trustSources =
    trustSpecs.length > 0
      ? trustSpecs
      : [resolveSource(report, undefined, ["trust"])].filter(
          (source): source is SourceSpec => source !== undefined,
        );

  const claimsRead = readJsonl(report, claimsSource, claimRecordSchema, warnings, "claims");
  const citationsRead = readJsonl(
    report,
    citationsSource,
    citationRecordSchema,
    warnings,
    "citations",
  );
  const relationsRead = readJsonl(
    report,
    relationsSource,
    relationRecordSchema,
    warnings,
    "relations",
  );
  const trustReads = trustSources.map((source) =>
    readJsonl(report, source, trustAssessmentRecordSchema, warnings, "trust"),
  );

  const claims = claimsRead.records.map((record) => record.value);
  const citations = citationsRead.records.map((record) => record.value);
  const claimIds = new Set(claims.map((claim) => claim.id));
  const citationIds = new Set(citations.map((citation) => citation.id));

  const relations = relationsRead.records.flatMap((record) => {
    if (claimIds.has(record.value.claimId) && citationIds.has(record.value.citationId)) {
      return [record.value];
    }
    dropRecord(
      record.source,
      "relation-reference-missing",
      `Dropped relation ${record.value.claimId}→${record.value.citationId}: references an unknown claim or citation.`,
      warnings,
    );
    return [];
  });

  const trust: TrustAssessmentRecord[] = [];
  for (const record of trustReads.flatMap((read) => read.records)) {
    if ("subjectType" in record.value) {
      const issue = nodeRelationTrustIssue(record.value, nodeExtraction);
      if (!issue) trust.push(record.value);
      else dropRecord(record.source, issue.code, issue.message, warnings);
      continue;
    }
    if (claimIds.has(record.value.claimId) && citationIds.has(record.value.citationId)) {
      trust.push(record.value);
      continue;
    }
    dropRecord(
      record.source,
      "trust-reference-missing",
      `Dropped TRUST record ${record.value.claimId}→${record.value.citationId}: references an unknown claim or citation.`,
      warnings,
    );
  }

  const knowledge = { claims, citations, relations, trust, warnings };
  return {
    knowledge,
    artifactOutcomes: {
      claims: aggregateOutcome(claimsRead.source ? [claimsRead.source] : []),
      citations: aggregateOutcome(citationsRead.source ? [citationsRead.source] : []),
      relations: aggregateOutcome(relationsRead.source ? [relationsRead.source] : []),
      trust: aggregateOutcome(trustReads.flatMap((read) => (read.source ? [read.source] : []))),
    },
  };
}

function resolveSource(
  report: InspectionReport,
  manifestPath: string | undefined,
  keywords: string[],
): SourceSpec | undefined {
  if (manifestPath && isSafeRepoRelativePath(manifestPath)) {
    // A declaration is authoritative even when its bytes are absent. Never substitute a heuristic.
    return { path: manifestPath, discovery: "declared" };
  }
  const paths = new Set([...report.tree.map((entry) => entry.path), ...Object.keys(report.files)]);
  for (const path of [...paths].sort()) {
    const lower = path.toLowerCase();
    if (lower.endsWith(".jsonl") && keywords.some((keyword) => lower.includes(keyword))) {
      return { path, discovery: "discovered" };
    }
  }
  return undefined;
}

function nodeManifestTrustSources(report: InspectionReport): SourceSpec[] {
  const content = report.files["node-manifest.json"]?.content;
  if (content === undefined) return [];
  try {
    const validation = validateNodeManifest(JSON.parse(content));
    const path = validation.ok ? validation.manifest?.trustAssessments?.path : undefined;
    return path ? [{ path, discovery: "declared" }] : [];
  } catch {
    return [];
  }
}

function uniqueSources(sources: SourceSpec[]): SourceSpec[] {
  const byPath = new Map<string, SourceSpec>();
  for (const source of sources) {
    const prior = byPath.get(source.path);
    if (!prior || source.discovery === "declared") byPath.set(source.path, source);
  }
  return [...byPath.values()];
}

function readJsonl<S extends z.ZodTypeAny>(
  report: InspectionReport,
  spec: SourceSpec | undefined,
  schema: S,
  warnings: string[],
  label: string,
): { records: Array<TaggedRecord<z.infer<S>>>; source?: MutableSourceOutcome } {
  if (!spec) return { records: [] };
  const file = report.files[spec.path];
  if (!file || file.content === undefined || file.truncated) {
    const exists = report.tree.some((entry) => entry.path === spec.path);
    const code = file?.truncated
      ? "source-truncated"
      : exists
        ? "source-not-fetched"
        : "source-missing";
    const message = file?.truncated
      ? `${label}: ${spec.path} was skipped because captured content was truncated.`
      : exists
        ? `${label}: ${spec.path} was not fetched within the inspection budget.`
        : `${label}: declared source ${spec.path} does not exist in the inspected tree.`;
    warnings.push(message);
    return {
      records: [],
      source: {
        ...spec,
        status: "skipped",
        loadedCount: 0,
        skippedCount: null,
        issues: [{ code, message }],
      },
    };
  }

  const parsed = parseJsonlArtifact(file.content, schema);
  const skippedCount = parsed.errors.length + parsed.truncatedCount;
  const issues: ArtifactOutcomeIssue[] = parsed.errors.slice(0, 199).map((error) => ({
    code: "record-invalid",
    message: error.message.slice(0, 2_000),
    line: error.line,
  }));
  if (parsed.truncated) {
    issues.push({
      code: "record-cap-reached",
      message: `${parsed.truncatedCount} record(s) after the cap were skipped.`,
    });
  }
  if (parsed.errors.length > 0) {
    warnings.push(
      `${label}: ${parsed.errors.length} invalid line(s) skipped in ${spec.path} (first: line ${parsed.errors[0]?.line}).`,
    );
  }
  if (parsed.truncated) warnings.push(`${label}: ${spec.path} truncated at record cap.`);

  const source: MutableSourceOutcome = {
    ...spec,
    status: parsed.records.length === 0 && skippedCount > 0 ? "invalid" : "loaded",
    loadedCount: parsed.records.length,
    skippedCount,
    issues,
  };
  return { records: parsed.records.map((value) => ({ value, source })), source };
}

function dropRecord(
  source: MutableSourceOutcome,
  code: string,
  message: string,
  warnings: string[],
): void {
  source.loadedCount -= 1;
  source.skippedCount = (source.skippedCount ?? 0) + 1;
  if (source.issues.length < 200) source.issues.push({ code, message: message.slice(0, 2_000) });
  if (source.loadedCount === 0) source.status = "invalid";
  warnings.push(message);
}

function aggregateOutcome(sources: MutableSourceOutcome[]): ArtifactOutcome {
  if (sources.length === 0) {
    return { status: "not-declared", loadedCount: 0, skippedCount: 0, sources: [] };
  }
  const status = sources.some((source) => source.status === "loaded")
    ? "loaded"
    : sources.some((source) => source.status === "invalid")
      ? "invalid"
      : "skipped";
  const skippedCount = sources.some((source) => source.skippedCount === null)
    ? null
    : sources.reduce((total, source) => total + (source.skippedCount ?? 0), 0);
  return {
    status,
    loadedCount: sources.reduce((total, source) => total + source.loadedCount, 0),
    skippedCount,
    sources: sources as ArtifactSourceOutcome[],
  };
}

function nodeRelationTrustIssue(
  record: Extract<TrustAssessmentRecord, { subjectType: "node-relation" }>,
  nodeExtraction: NodeExtractionReport | undefined,
): ArtifactOutcomeIssue | undefined {
  if (!nodeExtraction) {
    return {
      code: "node-context-unavailable",
      message: "Dropped node-relation TRUST record: node extraction context is unavailable.",
    };
  }
  const nodes = new Map(
    nodeExtraction.nodes
      .filter((entry) => entry.status === "ok" && entry.node)
      .map((entry) => [entry.node!.id, entry.node!]),
  );
  const claim = nodes.get(record.subject.claimNodeId);
  if (!claim || claim.kind !== "claim") {
    return {
      code: "trust-claim-node-missing",
      message: `Dropped node-relation TRUST record ${record.subject.claimNodeId}→${record.subject.evidenceNodeId}: the claim node was not extracted exactly.`,
    };
  }
  if (!record.subject.evidenceRepository) {
    const evidence = nodes.get(record.subject.evidenceNodeId);
    if (!evidence || evidence.kind !== record.subject.evidenceKind) {
      return {
        code: "trust-evidence-node-mismatch",
        message: `Dropped node-relation TRUST record ${record.subject.claimNodeId}→${record.subject.evidenceNodeId}: the local evidence node kind does not match.`,
      };
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
    return {
      code: "trust-edge-not-exact",
      message: `Dropped node-relation TRUST record ${record.subject.claimNodeId}→${record.subject.evidenceNodeId}: expected one exact author edge declaration, found ${matches.length}.`,
    };
  }
  return undefined;
}

function sameTargetRepository(
  left: { githubRepositoryId: string; commitSha: string } | undefined,
  right: { githubRepositoryId: string; commitSha: string } | undefined,
): boolean {
  if (!left || !right) return left === right;
  return left.githubRepositoryId === right.githubRepositoryId && left.commitSha === right.commitSha;
}
