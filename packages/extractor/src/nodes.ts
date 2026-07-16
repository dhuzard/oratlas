import {
  MAX_NODE_MANIFEST_BYTES,
  MAX_NODE_RECORD_BYTES,
  MAX_NODE_SOURCE_FILES,
  knowledgeNodeSchema,
  nodeEdgeSchema,
  validateNodeManifest,
  type InspectionReport,
  type KnowledgeNode,
  type NodeManifestSource,
} from "@oratlas/contracts";
import { isExampleDoi, isZenodoDoi, normalizeDoi } from "@oratlas/zenodo";
import { z } from "zod";
import { EXTRACTOR_VERSION } from "./version.js";

export const nodeRecordStatusSchema = z.enum(["ok", "invalid", "skipped"]);
export type NodeRecordStatus = z.infer<typeof nodeRecordStatusSchema>;

export const nodeExtractionIssueSchema = z
  .object({
    severity: z.enum(["error", "warning"]),
    code: z.string().min(1).max(80),
    message: z.string().min(1).max(2_000),
    field: z.string().max(512).optional(),
  })
  .strict();
export type NodeExtractionIssue = z.infer<typeof nodeExtractionIssueSchema>;

export const nodeFieldProvenanceSchema = z
  .object({
    source: z.literal("node-record"),
    file: z.string().min(1).max(512),
    pointer: z.string().min(1).max(1_000),
    commitSha: z
      .string()
      .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i)
      .optional(),
    extractorVersion: z.string().min(1).max(80),
    confidence: z.literal(1),
  })
  .strict();
export type NodeFieldProvenance = z.infer<typeof nodeFieldProvenanceSchema>;

export const nodeDoiReferenceSchema = z
  .object({
    field: z.enum(["versionDoi", "conceptDoi", "payload.doi"]),
    input: z.string().min(1).max(500),
    normalizedDoi: z.string().min(1).max(500),
    isZenodo: z.boolean(),
    isExample: z.boolean(),
  })
  .strict();
export type NodeDoiReference = z.infer<typeof nodeDoiReferenceSchema>;

export const extractedNodeRecordSchema = z
  .object({
    status: nodeRecordStatusSchema,
    sourcePath: z.string().min(1).max(512),
    sourcePointer: z.string().min(1).max(512),
    declaredId: z.string().max(120).optional(),
    node: knowledgeNodeSchema.optional(),
    fieldProvenance: z.record(z.string(), nodeFieldProvenanceSchema),
    doiReferences: z.array(nodeDoiReferenceSchema),
    issues: z.array(nodeExtractionIssueSchema),
  })
  .strict();
export type ExtractedNodeRecord = z.infer<typeof extractedNodeRecordSchema>;

export const extractedEdgeRecordSchema = z
  .object({
    status: nodeRecordStatusSchema,
    sourcePath: z.string().min(1).max(512),
    sourcePointer: z.string().min(1).max(512),
    edge: nodeEdgeSchema.optional(),
    issues: z.array(nodeExtractionIssueSchema),
  })
  .strict();
export type ExtractedEdgeRecord = z.infer<typeof extractedEdgeRecordSchema>;

export const nodeExtractionReportSchema = z
  .object({
    schemaVersion: z.literal("1.0.0"),
    extractorVersion: z.string().min(1).max(80),
    commitSha: z
      .string()
      .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i)
      .optional(),
    manifest: z
      .object({
        path: z.literal("node-manifest.json"),
        status: z.enum(["ok", "invalid", "skipped"]),
        errors: z.array(z.string().max(2_000)),
      })
      .strict(),
    nodes: z.array(extractedNodeRecordSchema).max(MAX_NODE_SOURCE_FILES + 1),
    edges: z.array(extractedEdgeRecordSchema).max(MAX_NODE_SOURCE_FILES + 1),
    counts: z
      .object({
        ok: z.number().int().nonnegative(),
        invalid: z.number().int().nonnegative(),
        skipped: z.number().int().nonnegative(),
        edgesOk: z.number().int().nonnegative(),
        edgesInvalid: z.number().int().nonnegative(),
        edgesSkipped: z.number().int().nonnegative(),
      })
      .strict(),
    errors: z.array(nodeExtractionIssueSchema),
    warnings: z.array(nodeExtractionIssueSchema),
  })
  .strict();
export type NodeExtractionReport = z.infer<typeof nodeExtractionReportSchema>;

interface RawRecord {
  sourcePath: string;
  sourcePointer: string;
  value?: unknown;
  issue?: NodeExtractionIssue;
}

/**
 * Deterministically extract first-class node declarations from an already
 * inspected repository. This function performs no I/O and never reads or
 * executes artifact content; all bytes came from the bounded GitHub capture.
 */
export function extractKnowledgeNodes(report: InspectionReport): NodeExtractionReport {
  const base = emptyReport(report);
  const manifestFile = report.files["node-manifest.json"];
  if (!manifestFile) {
    const issue = warning(
      report.tree.some((entry) => entry.path === "node-manifest.json")
        ? "manifest-not-fetched"
        : "manifest-not-found",
      report.tree.some((entry) => entry.path === "node-manifest.json")
        ? "node-manifest.json was present but was not fetched within the inspection budget."
        : "No node-manifest.json was declared by the repository.",
    );
    base.warnings.push(issue);
    return finalize(base);
  }
  if (manifestFile.truncated || manifestFile.size > MAX_NODE_MANIFEST_BYTES) {
    return invalidManifest(base, "node-manifest.json exceeds the 1,000,000-byte manifest cap.");
  }
  if (!manifestFile.content) {
    base.warnings.push(
      warning("manifest-not-fetched", "node-manifest.json did not include captured content."),
    );
    return finalize(base);
  }
  if (Buffer.byteLength(manifestFile.content, "utf-8") > MAX_NODE_MANIFEST_BYTES) {
    return invalidManifest(base, "node-manifest.json exceeds the 1,000,000-byte manifest cap.");
  }

  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(manifestFile.content);
  } catch {
    return invalidManifest(base, "node-manifest.json is not valid JSON.");
  }
  const validation = validateNodeManifest(rawManifest);
  if (!validation.ok || !validation.manifest) {
    base.manifest.status = "invalid";
    base.manifest.errors = validation.errors;
    for (const message of validation.errors) {
      base.errors.push(error("manifest-schema-invalid", message));
    }
    return finalize(base);
  }
  base.manifest.status = "ok";

  const nodeRecords = readSource(report, validation.manifest.nodes);
  const seenNodeIds = new Set<string>();
  for (const record of nodeRecords) {
    const extracted = extractNodeRecord(report, record, seenNodeIds);
    base.nodes.push(extracted);
  }

  const validNodeIds = new Set(
    base.nodes
      .filter((record): record is ExtractedNodeRecord & { node: KnowledgeNode } =>
        Boolean(record.status === "ok" && record.node),
      )
      .map((record) => record.node.id),
  );
  const seenEdges = new Set<string>();
  if (validation.manifest.edges) {
    for (const record of readSource(report, validation.manifest.edges)) {
      base.edges.push(extractEdgeRecord(record, validNodeIds, seenEdges));
    }
  }

  base.counts = countRecords(base.nodes, base.edges);
  for (const record of [...base.nodes, ...base.edges]) {
    for (const issue of record.issues) {
      (issue.severity === "error" ? base.errors : base.warnings).push(issue);
    }
  }
  return finalize(base);
}

function emptyReport(report: InspectionReport): NodeExtractionReport {
  return createEmptyNodeExtractionReport({
    commitSha: report.selectedSource?.commitSha ?? report.latestCommitSha,
  });
}

/** Build a schema-valid empty report for captures with no node manifest. */
export function createEmptyNodeExtractionReport(
  options: { commitSha?: string; extractorVersion?: string } = {},
): NodeExtractionReport {
  return nodeExtractionReportSchema.parse({
    schemaVersion: "1.0.0",
    extractorVersion: options.extractorVersion ?? EXTRACTOR_VERSION,
    commitSha: options.commitSha,
    manifest: { path: "node-manifest.json", status: "skipped", errors: [] },
    nodes: [],
    edges: [],
    counts: { ok: 0, invalid: 0, skipped: 0, edgesOk: 0, edgesInvalid: 0, edgesSkipped: 0 },
    errors: [],
    warnings: [],
  });
}

function invalidManifest(report: NodeExtractionReport, message: string): NodeExtractionReport {
  report.manifest.status = "invalid";
  report.manifest.errors.push(message);
  report.errors.push(error("manifest-invalid", message));
  return finalize(report);
}

function finalize(report: NodeExtractionReport): NodeExtractionReport {
  return nodeExtractionReportSchema.parse(report);
}

function readSource(report: InspectionReport, source: NodeManifestSource): RawRecord[] {
  if (source.format === "json") {
    return source.files.map((path) => readJsonFile(report, path));
  }
  const file = report.files[source.path];
  if (!file) return [missingSource(report, source.path)];
  if (file.truncated) return [skippedSource(source.path, file.size)];
  if (file.content === undefined) return [missingSource(report, source.path)];

  const records: RawRecord[] = [];
  const lines = file.content.split(/\r?\n/);
  let recordCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const line = rawLine.trim();
    if (!line) continue;
    const pointer = `line:${index + 1}`;
    if (recordCount >= MAX_NODE_SOURCE_FILES) {
      records.push({
        sourcePath: source.path,
        sourcePointer: pointer,
        issue: warning(
          "record-cap-reached",
          `Records after the ${MAX_NODE_SOURCE_FILES}-record cap were skipped.`,
        ),
      });
      break;
    }
    recordCount += 1;
    if (Buffer.byteLength(rawLine, "utf-8") > MAX_NODE_RECORD_BYTES) {
      records.push({
        sourcePath: source.path,
        sourcePointer: pointer,
        issue: error("record-oversized", "Record exceeds the 1,000,000-byte record cap."),
      });
      continue;
    }
    try {
      records.push({ sourcePath: source.path, sourcePointer: pointer, value: JSON.parse(line) });
    } catch {
      records.push({
        sourcePath: source.path,
        sourcePointer: pointer,
        issue: error("record-invalid-json", "Record is not valid JSON."),
      });
    }
  }
  return records;
}

function readJsonFile(report: InspectionReport, path: string): RawRecord {
  const file = report.files[path];
  if (!file) return missingSource(report, path);
  if (file.truncated) return skippedSource(path, file.size);
  if (file.content === undefined) return missingSource(report, path);
  if (Buffer.byteLength(file.content, "utf-8") > MAX_NODE_RECORD_BYTES) {
    return {
      sourcePath: path,
      sourcePointer: "$",
      issue: error("record-oversized", "Record exceeds the 1,000,000-byte record cap."),
    };
  }
  try {
    return { sourcePath: path, sourcePointer: "$", value: JSON.parse(file.content) };
  } catch {
    return {
      sourcePath: path,
      sourcePointer: "$",
      issue: error("record-invalid-json", "Record is not valid JSON."),
    };
  }
}

function missingSource(report: InspectionReport, path: string): RawRecord {
  const exists = report.tree.some((entry) => entry.path === path);
  return {
    sourcePath: path,
    sourcePointer: "$",
    issue: error(
      exists ? "source-not-fetched" : "source-missing",
      exists
        ? `Declared source '${path}' was not fetched within the inspection budget.`
        : `Declared source '${path}' does not exist in the inspected tree.`,
    ),
  };
}

function skippedSource(path: string, size: number): RawRecord {
  return {
    sourcePath: path,
    sourcePointer: "$",
    issue: error("source-oversized", `Declared source '${path}' was skipped at ${size} bytes.`),
  };
}

function extractNodeRecord(
  report: InspectionReport,
  record: RawRecord,
  seenNodeIds: Set<string>,
): ExtractedNodeRecord {
  const declaredId = rawStringField(record.value, "id");
  if (record.issue) return nodeFailure(record, declaredId);

  const parsed = knowledgeNodeSchema.safeParse(record.value);
  if (!parsed.success) {
    return nodeFailure(record, declaredId, issuesFromZod(parsed.error.issues));
  }
  const node = parsed.data;
  const issues: NodeExtractionIssue[] = [];

  if (seenNodeIds.has(node.id)) {
    issues.push(error("duplicate-node-id", `Node id '${node.id}' was already declared.`, "id"));
  } else {
    seenNodeIds.add(node.id);
  }
  if (node.provenance.sourcePath !== record.sourcePath) {
    issues.push(
      error(
        "provenance-mismatch",
        `Declared provenance path '${node.provenance.sourcePath}' does not match '${record.sourcePath}'.`,
        "provenance.sourcePath",
      ),
    );
  }
  const commitSha = report.selectedSource?.commitSha ?? report.latestCommitSha;
  if (node.provenance.commitSha && node.provenance.commitSha !== commitSha) {
    issues.push(
      error(
        "provenance-mismatch",
        "Declared provenance commit does not match the inspected commit.",
        "provenance.commitSha",
      ),
    );
  }
  if (
    node.provenance.repositoryUrl &&
    normalizeRepositoryUrl(node.provenance.repositoryUrl) !==
      normalizeRepositoryUrl(report.repo.canonicalUrl)
  ) {
    issues.push(
      error(
        "provenance-mismatch",
        "Declared provenance repository does not match the inspected repository.",
        "provenance.repositoryUrl",
      ),
    );
  }

  const treeSizes = new Map(report.tree.map((entry) => [entry.path, entry.size]));
  const artifactPaths = nodeArtifactPaths(node);
  for (const [field, path] of artifactPaths) {
    if (!treeSizes.has(path)) {
      issues.push(
        error(
          "artifact-missing",
          `Referenced artifact '${path}' does not exist in the inspected tree.`,
          field,
        ),
      );
    }
  }
  if (node.kind === "dataset" && node.payload.artifactPath) {
    const treeSize = treeSizes.get(node.payload.artifactPath);
    if (treeSize !== undefined && treeSize !== node.payload.sizeBytes) {
      issues.push(
        warning(
          "artifact-size-mismatch",
          `Declared dataset size ${node.payload.sizeBytes} differs from tree size ${treeSize}.`,
          "payload.sizeBytes",
        ),
      );
    }
  }

  const doiResult = nodeDois(node);
  const doiReferences = doiResult.references;
  issues.push(...doiResult.issues);
  const version = doiReferences.find((reference) => reference.field === "versionDoi");
  const concept = doiReferences.find((reference) => reference.field === "conceptDoi");
  if (version && concept && version.normalizedDoi === concept.normalizedDoi) {
    issues.push(
      error(
        "doi-fields-conflated",
        "Concept DOI must be distinct from version DOI after normalization.",
        "conceptDoi",
      ),
    );
  }
  for (const reference of doiReferences) {
    if (reference.isExample) {
      issues.push(
        warning(
          "example-doi",
          `Reserved example DOI '${reference.normalizedDoi}' must never be resolved or linked.`,
          reference.field,
        ),
      );
    }
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    status: hasErrors ? "invalid" : "ok",
    sourcePath: record.sourcePath,
    sourcePointer: record.sourcePointer,
    declaredId: node.id,
    node: hasErrors ? undefined : node,
    fieldProvenance: hasErrors ? {} : provenanceForNode(node, record, commitSha),
    doiReferences,
    issues,
  };
}

function nodeFailure(
  record: RawRecord,
  declaredId?: string,
  issues: NodeExtractionIssue[] = [],
): ExtractedNodeRecord {
  const allIssues = record.issue ? [record.issue, ...issues] : issues;
  const skipped = allIssues.some((issue) =>
    ["source-oversized", "source-not-fetched", "record-oversized", "record-cap-reached"].includes(
      issue.code,
    ),
  );
  return {
    status: skipped ? "skipped" : "invalid",
    sourcePath: record.sourcePath,
    sourcePointer: record.sourcePointer,
    declaredId,
    fieldProvenance: {},
    doiReferences: [],
    issues: allIssues,
  };
}

function extractEdgeRecord(
  record: RawRecord,
  validNodeIds: Set<string>,
  seenEdges: Set<string>,
): ExtractedEdgeRecord {
  if (record.issue) return edgeFailure(record);
  const parsed = nodeEdgeSchema.safeParse(record.value);
  if (!parsed.success) return edgeFailure(record, issuesFromZod(parsed.error.issues));

  const edge = parsed.data;
  const issues: NodeExtractionIssue[] = [];
  if (!validNodeIds.has(edge.sourceNodeId) || !validNodeIds.has(edge.targetNodeId)) {
    issues.push(
      error(
        "edge-unknown-node",
        `Edge ${edge.sourceNodeId}→${edge.targetNodeId} references a node that was not validly extracted.`,
      ),
    );
  }
  const key = `${edge.sourceNodeId}\0${edge.targetNodeId}\0${edge.relationType}`;
  if (seenEdges.has(key)) {
    issues.push(error("duplicate-edge", "The same typed node edge was already declared."));
  } else {
    seenEdges.add(key);
  }
  const hasErrors = issues.some((issue) => issue.severity === "error");
  return {
    status: hasErrors ? "invalid" : "ok",
    sourcePath: record.sourcePath,
    sourcePointer: record.sourcePointer,
    edge: hasErrors ? undefined : edge,
    issues,
  };
}

function edgeFailure(record: RawRecord, issues: NodeExtractionIssue[] = []): ExtractedEdgeRecord {
  const allIssues = record.issue ? [record.issue, ...issues] : issues;
  const skipped = allIssues.some((issue) =>
    ["source-oversized", "source-not-fetched", "record-oversized", "record-cap-reached"].includes(
      issue.code,
    ),
  );
  return {
    status: skipped ? "skipped" : "invalid",
    sourcePath: record.sourcePath,
    sourcePointer: record.sourcePointer,
    issues: allIssues,
  };
}

function nodeArtifactPaths(node: KnowledgeNode): Array<[string, string]> {
  if (node.kind === "figure") return [["payload.artifactPath", node.payload.artifactPath]];
  if (node.kind === "dataset" && node.payload.artifactPath) {
    return [["payload.artifactPath", node.payload.artifactPath]];
  }
  if (node.kind === "code") {
    return node.payload.entryPoints.map((path, index) => [`payload.entryPoints.${index}`, path]);
  }
  return [];
}

function nodeDois(node: KnowledgeNode): {
  references: NodeDoiReference[];
  issues: NodeExtractionIssue[];
} {
  const inputs: Array<[NodeDoiReference["field"], string | undefined]> = [
    ["versionDoi", node.versionDoi],
    ["conceptDoi", node.conceptDoi],
    ["payload.doi", node.kind === "dataset" ? node.payload.doi : undefined],
  ];
  const references: NodeDoiReference[] = [];
  const issues: NodeExtractionIssue[] = [];
  for (const [field, input] of inputs) {
    if (!input) continue;
    const normalized = normalizeDoi(input);
    if (!normalized.ok || !normalized.doi) {
      issues.push(
        error(
          "doi-invalid",
          `DOI normalization failed: ${normalized.reason ?? "invalid DOI"}`,
          field,
        ),
      );
      continue;
    }
    references.push({
      field,
      input,
      normalizedDoi: normalized.doi,
      isZenodo: isZenodoDoi(normalized.doi),
      isExample: isExampleDoi(normalized.doi),
    });
  }
  return { references, issues };
}

function provenanceForNode(
  node: KnowledgeNode,
  record: RawRecord,
  commitSha: string | undefined,
): Record<string, NodeFieldProvenance> {
  const fields: Record<string, NodeFieldProvenance> = {};
  for (const field of leafPaths(node)) {
    fields[field] = {
      source: "node-record",
      file: record.sourcePath,
      pointer: pointerJoin(record.sourcePointer, field),
      commitSha,
      extractorVersion: EXTRACTOR_VERSION,
      confidence: 1,
    };
  }
  return fields;
}

function leafPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      leafPaths(item, prefix ? `${prefix}.${index}` : `${index}`),
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      leafPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return prefix ? [prefix] : [];
}

function pointerJoin(sourcePointer: string, field: string): string {
  return sourcePointer === "$" ? `$.${field}` : `${sourcePointer}.${field}`;
}

function rawStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function normalizeRepositoryUrl(url: string): string {
  return url
    .toLowerCase()
    .replace(/\.git$/i, "")
    .replace(/\/+$/, "");
}

function issuesFromZod(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): NodeExtractionIssue[] {
  return issues.map((issue) => {
    const field = issue.path.map(String).join(".") || undefined;
    return error("record-schema-invalid", `${field ?? "(root)"}: ${issue.message}`, field);
  });
}

function countRecords(
  nodes: ExtractedNodeRecord[],
  edges: ExtractedEdgeRecord[],
): NodeExtractionReport["counts"] {
  return {
    ok: nodes.filter((record) => record.status === "ok").length,
    invalid: nodes.filter((record) => record.status === "invalid").length,
    skipped: nodes.filter((record) => record.status === "skipped").length,
    edgesOk: edges.filter((record) => record.status === "ok").length,
    edgesInvalid: edges.filter((record) => record.status === "invalid").length,
    edgesSkipped: edges.filter((record) => record.status === "skipped").length,
  };
}

function error(code: string, message: string, field?: string): NodeExtractionIssue {
  return { severity: "error", code, message, field };
}

function warning(code: string, message: string, field?: string): NodeExtractionIssue {
  return { severity: "warning", code, message, field };
}
