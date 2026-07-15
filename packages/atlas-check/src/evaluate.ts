import {
  ATLAS_CHECK_SCHEMA_VERSION,
  ATLAS_CHECK_TOOL_VERSION,
  TRUST_CRITERIA,
  atlasCheckReportSchema,
  citationRecordSchema,
  claimRecordSchema,
  isSafeRepoRelativePath,
  relationRecordSchema,
  trustRecordSchema,
  validateReviewManifest,
  type AtlasCheckFinding,
  type AtlasCheckReport,
  type CitationRecord,
  type ClaimRecord,
  type RelationRecord,
  type ReviewManifest,
  type TrustRecord,
} from "@oratlas/contracts";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { type z } from "zod";
import { hasSubstantiveMarkdown, markdownSections, normalizeHeading } from "./markdown.js";

const MAX_DOC_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_JSONL_LINES = 10_000;
const MAX_RECORDS = 5_000;
const MAX_FINDINGS = 1_000;

const FAIR_SECTIONS = ["findable", "accessible", "interoperable", "reusable"] as const;

type ArtifactKind = "claims" | "citations" | "relations" | "trustAssessments";
type Located<T> = { value: T; line: number; path: string };

interface ReadResult {
  status: "ok" | "missing" | "unsafe" | "oversized" | "unreadable";
  content?: string;
  detail?: string;
}

class FindingSink {
  readonly findings: AtlasCheckFinding[] = [];
  omitted = 0;

  add(finding: AtlasCheckFinding): void {
    if (this.findings.length >= MAX_FINDINGS - 1) {
      this.omitted += 1;
      return;
    }
    this.findings.push({
      ...finding,
      message: cleanText(finding.message),
      suggestion: finding.suggestion ? cleanText(finding.suggestion) : undefined,
    });
  }

  finish(): AtlasCheckFinding[] {
    if (this.omitted > 0) {
      this.findings.push({
        ruleId: "ORATLAS-LIMIT-003",
        severity: "error",
        message: `${this.omitted} additional findings were omitted after the ${MAX_FINDINGS}-finding safety cap.`,
        suggestion: "Fix the reported findings, then run Atlas Check again for the remainder.",
      });
    }
    return this.findings.sort(compareFindings);
  }
}

class BoundedRepositoryReader {
  private totalBytes = 0;
  private readonly cache = new Map<string, ReadResult>();
  filesChecked = 0;

  private constructor(
    private readonly root: string,
    private readonly canonicalRoot: string,
  ) {}

  static async create(root: string): Promise<BoundedRepositoryReader> {
    const resolvedRoot = resolve(root);
    const rootStat = await lstat(resolvedRoot);
    if (!rootStat.isDirectory()) throw new Error("Atlas Check root must be a directory.");
    return new BoundedRepositoryReader(resolvedRoot, await realpath(resolvedRoot));
  }

  async read(path: string, maxBytes: number): Promise<ReadResult> {
    const cached = this.cache.get(path);
    if (cached) return cached;
    if (!isSafeRepoRelativePath(path) || isAbsolute(path)) {
      return { status: "unsafe", detail: "Path is not a safe repository-relative path." };
    }

    const absolute = resolve(this.root, ...path.split("/"));
    const rootPrefix = this.root.endsWith(sep) ? this.root : `${this.root}${sep}`;
    if (!absolute.startsWith(rootPrefix)) {
      return { status: "unsafe", detail: "Path resolves outside the repository root." };
    }
    try {
      const stat = await lstat(absolute);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        const result: ReadResult = {
          status: "unsafe",
          detail: stat.isSymbolicLink()
            ? "Symbolic-link inputs are not followed."
            : "Path is not a regular file.",
        };
        this.cache.set(path, result);
        return result;
      }
      const canonical = await realpath(absolute);
      const relativeCanonical = relative(this.canonicalRoot, canonical);
      if (relativeCanonical.startsWith("..") || isAbsolute(relativeCanonical)) {
        const result: ReadResult = {
          status: "unsafe",
          detail: "File resolves outside the repository root.",
        };
        this.cache.set(path, result);
        return result;
      }
      if (stat.size > maxBytes) {
        const result: ReadResult = {
          status: "oversized",
          detail: `File is ${stat.size} bytes; limit is ${maxBytes} bytes.`,
        };
        this.cache.set(path, result);
        return result;
      }
      if (this.totalBytes + stat.size > MAX_TOTAL_BYTES) {
        const result: ReadResult = {
          status: "oversized",
          detail: `Reading the file would exceed the ${MAX_TOTAL_BYTES}-byte total input budget.`,
        };
        this.cache.set(path, result);
        return result;
      }
      const content = await readFile(absolute, "utf8");
      const actualBytes = Buffer.byteLength(content, "utf8");
      if (actualBytes > maxBytes || this.totalBytes + actualBytes > MAX_TOTAL_BYTES) {
        const result: ReadResult = {
          status: "oversized",
          detail: "File changed while it was read and exceeded an input budget.",
        };
        this.cache.set(path, result);
        return result;
      }
      this.totalBytes += actualBytes;
      this.filesChecked += 1;
      const result: ReadResult = { status: "ok", content };
      this.cache.set(path, result);
      return result;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const result: ReadResult =
        code === "ENOENT"
          ? { status: "missing" }
          : { status: "unreadable", detail: "File could not be read safely." };
      this.cache.set(path, result);
      return result;
    }
  }
}

export interface AtlasCheckOptions {
  root?: string;
}

/** Evaluate a local review repository without network access, code execution, or LLM calls. */
export async function evaluateAtlasRepository(
  options: AtlasCheckOptions = {},
): Promise<AtlasCheckReport> {
  const reader = await BoundedRepositoryReader.create(options.root ?? process.cwd());
  const sink = new FindingSink();
  let recordsChecked = 0;

  await checkMarkdownDocument(reader, sink, "TRUST.md", "TRUST", [
    ...TRUST_CRITERIA.map((criterion) => normalizeHeading(criterion)),
  ]);
  await checkMarkdownDocument(reader, sink, "FAIR.md", "FAIR", [...FAIR_SECTIONS]);

  const manifestResult = await reader.read("review-manifest.json", MAX_DOC_BYTES);
  let manifest: ReviewManifest | undefined;
  let manifestContent: string | undefined;
  if (manifestResult.status === "missing") {
    sink.add({
      ruleId: "ORATLAS-MANIFEST-001",
      severity: "error",
      message:
        "review-manifest.json is missing, so evidence artifacts cannot be located authoritatively.",
      suggestion:
        "Add a schemaVersion 1.0.0 review manifest and declare every evidence artifact path.",
    });
  } else if (manifestResult.status !== "ok") {
    addReadFailure(sink, "review-manifest.json", manifestResult);
  } else {
    manifestContent = manifestResult.content ?? "";
    try {
      const validation = validateReviewManifest(JSON.parse(manifestContent));
      if (validation.ok) {
        manifest = validation.manifest;
        if (!manifest?.repository.commit) {
          sink.add({
            ruleId: "ORATLAS-MANIFEST-004",
            severity: "warning",
            message: "The manifest does not pin repository.commit to an immutable source revision.",
            path: "review-manifest.json",
            line: lineOfJsonKey(manifestContent, "repository"),
            suggestion:
              "Set repository.commit to the full Git commit SHA used for this review version.",
          });
        }
      } else {
        sink.add({
          ruleId: "ORATLAS-MANIFEST-003",
          severity: "error",
          message: `Manifest schema validation failed: ${validation.errors.slice(0, 5).join("; ")}`,
          path: "review-manifest.json",
          line: 1,
          suggestion:
            "Validate the file against packages/contracts/schemas/review-manifest.schema.json.",
        });
      }
    } catch {
      sink.add({
        ruleId: "ORATLAS-MANIFEST-002",
        severity: "error",
        message: "review-manifest.json is not valid JSON.",
        path: "review-manifest.json",
        line: 1,
        suggestion: "Correct the JSON syntax before running Atlas Check again.",
      });
    }
  }

  const claims: Located<ClaimRecord>[] = [];
  const citations: Located<CitationRecord>[] = [];
  const relations: Located<RelationRecord>[] = [];
  const trust: Located<TrustRecord>[] = [];

  if (manifest) {
    const artifactSpecs: Array<{
      kind: ArtifactKind;
      schema: z.ZodTypeAny;
      target: Located<unknown>[];
    }> = [
      { kind: "claims", schema: claimRecordSchema, target: claims },
      { kind: "citations", schema: citationRecordSchema, target: citations },
      { kind: "relations", schema: relationRecordSchema, target: relations },
      { kind: "trustAssessments", schema: trustRecordSchema, target: trust },
    ];

    for (const spec of artifactSpecs) {
      const path = manifest.artifacts?.[spec.kind];
      if (!path) {
        sink.add({
          ruleId: "ORATLAS-ARTIFACT-001",
          severity: "warning",
          message: `The manifest does not declare artifacts.${spec.kind}.`,
          path: "review-manifest.json",
          line: manifestContent ? lineOfJsonKey(manifestContent, "artifacts") : 1,
          suggestion: `Declare the repository-relative ${spec.kind} JSONL path in the artifacts block.`,
        });
        continue;
      }
      const parsed = await readJsonl(reader, sink, path, spec.schema, spec.kind);
      spec.target.push(...parsed.records);
      recordsChecked += parsed.checked;
    }

    const provenancePath = manifest.artifacts?.provenance;
    if (!provenancePath) {
      sink.add({
        ruleId: "ORATLAS-PROVENANCE-001",
        severity: "warning",
        message: "The manifest does not declare a provenance artifact.",
        path: "review-manifest.json",
        line: manifestContent ? lineOfJsonKey(manifestContent, "artifacts") : 1,
        suggestion: "Declare artifacts.provenance so methods and pipeline lineage can be audited.",
      });
    } else {
      const provenance = await reader.read(provenancePath, MAX_ARTIFACT_BYTES);
      if (provenance.status !== "ok") addArtifactReadFailure(sink, provenancePath, provenance);
    }
  }

  checkEvidenceGraph(sink, claims, citations, relations, trust);

  const findings = sink.finish();
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const notices = findings.filter((finding) => finding.severity === "notice").length;
  return atlasCheckReportSchema.parse({
    schemaVersion: ATLAS_CHECK_SCHEMA_VERSION,
    tool: { name: "oratlas-check", version: ATLAS_CHECK_TOOL_VERSION },
    summary: {
      passed: errors === 0,
      errors,
      warnings,
      notices,
      filesChecked: reader.filesChecked,
      recordsChecked,
    },
    findings,
  });
}

async function checkMarkdownDocument(
  reader: BoundedRepositoryReader,
  sink: FindingSink,
  path: "TRUST.md" | "FAIR.md",
  label: "TRUST" | "FAIR",
  requiredSections: string[],
): Promise<void> {
  const result = await reader.read(path, MAX_DOC_BYTES);
  if (result.status === "missing") {
    sink.add({
      ruleId: label === "TRUST" ? "ORATLAS-DOC-001" : "ORATLAS-DOC-002",
      severity: "warning",
      message: `${path} is missing.`,
      suggestion:
        label === "TRUST"
          ? "Add TRUST.md with one substantive section for each relation-specific TRUST criterion."
          : "Add FAIR.md with substantive Findable, Accessible, Interoperable, and Reusable sections.",
    });
    return;
  }
  if (result.status !== "ok") {
    addReadFailure(sink, path, result);
    return;
  }
  const sections = markdownSections(result.content ?? "");
  for (const required of requiredSections) {
    const section = sections.find((candidate) => headingMatches(candidate.heading, required));
    if (!section) {
      sink.add({
        ruleId: "ORATLAS-DOC-003",
        severity: "warning",
        message: `${path} does not contain a '${displaySection(required)}' section.`,
        path,
        line: 1,
        suggestion: `Add a Markdown heading named '${displaySection(required)}' and document concrete evidence, limitations, or planned improvements.`,
      });
    } else if (!hasSubstantiveMarkdown(section.content)) {
      sink.add({
        ruleId: "ORATLAS-DOC-004",
        severity: "warning",
        message: `The '${displaySection(required)}' section has no substantive explanation.`,
        path,
        line: section.line,
        suggestion:
          "Explain the evidence, limitation, and remediation; headings, badges, and links alone do not count.",
      });
    }
  }
}

function headingMatches(heading: string, required: string): boolean {
  if (heading === required) return true;
  if (!(FAIR_SECTIONS as readonly string[]).includes(required)) return false;
  const prefix = required[0];
  return Boolean(prefix && (heading === prefix || heading === `${prefix} ${required}`));
}

function displaySection(section: string): string {
  return section.replace(/\b\w/g, (character) => character.toUpperCase());
}

async function readJsonl(
  reader: BoundedRepositoryReader,
  sink: FindingSink,
  path: string,
  schema: z.ZodTypeAny,
  label: string,
): Promise<{ records: Located<unknown>[]; checked: number }> {
  const result = await reader.read(path, MAX_ARTIFACT_BYTES);
  if (result.status !== "ok") {
    addArtifactReadFailure(sink, path, result);
    return { records: [], checked: 0 };
  }
  const lines = (result.content ?? "").split(/\r?\n/);
  const records: Located<unknown>[] = [];
  let checked = 0;
  if (lines.length > MAX_JSONL_LINES) {
    sink.add({
      ruleId: "ORATLAS-LIMIT-002",
      severity: "error",
      message: `${path} has ${lines.length} lines; only ${MAX_JSONL_LINES} are inspected.`,
      path,
      line: MAX_JSONL_LINES + 1,
      suggestion:
        "Split the artifact or remove blank/invalid lines to stay within the deterministic inspection limit.",
    });
  }
  for (let index = 0; index < Math.min(lines.length, MAX_JSONL_LINES); index += 1) {
    const line = lines[index]?.trim();
    if (!line) continue;
    if (records.length >= MAX_RECORDS) {
      sink.add({
        ruleId: "ORATLAS-LIMIT-001",
        severity: "error",
        message: `${path} exceeds the ${MAX_RECORDS}-record inspection cap.`,
        path,
        line: index + 1,
        suggestion: "Split the artifact into a supported review version before evaluation.",
      });
      break;
    }
    checked += 1;
    try {
      const parsed = schema.safeParse(JSON.parse(line));
      if (parsed.success) records.push({ value: parsed.data, line: index + 1, path });
      else {
        const details = parsed.error.issues
          .slice(0, 3)
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        sink.add({
          ruleId: "ORATLAS-ARTIFACT-003",
          severity: "error",
          message: `Invalid ${label} record: ${details}`,
          path,
          line: index + 1,
          suggestion:
            "Correct this record to match the declared Open Review Atlas artifact schema.",
        });
      }
    } catch {
      sink.add({
        ruleId: "ORATLAS-ARTIFACT-002",
        severity: "error",
        message: `Invalid JSON in the ${label} artifact.`,
        path,
        line: index + 1,
        suggestion: "Store exactly one valid JSON object on each non-empty JSONL line.",
      });
    }
  }
  return { records, checked };
}

function checkEvidenceGraph(
  sink: FindingSink,
  claims: Located<ClaimRecord>[],
  citations: Located<CitationRecord>[],
  relations: Located<RelationRecord>[],
  trust: Located<TrustRecord>[],
): void {
  const claimPath = pathFor(claims, "knowledge/claims.jsonl");
  const citationPath = pathFor(citations, "knowledge/citations.jsonl");
  const relationPath = pathFor(relations, "knowledge/relations.jsonl");
  const trustPath = pathFor(trust, "knowledge/trust.jsonl");
  const claimIds = uniqueIds(sink, claims, claimPath, "claim");
  const citationIds = uniqueIds(sink, citations, citationPath, "citation");
  const relationPairs = new Set<string>();
  const relatedClaimIds = new Set<string>();

  for (const claim of claims) {
    if (!claim.value.anchor) {
      sink.add({
        ruleId: "ORATLAS-CLAIM-001",
        severity: "warning",
        message: `Claim '${claim.value.id}' has no source anchor.`,
        path: claimPath,
        line: claim.line,
        suggestion:
          "Add a stable section or fragment anchor so reviewers can locate the claim in context.",
      });
    }
  }
  for (const citation of citations) {
    if (!citation.value.doi && !citation.value.pmid && !citation.value.openAlexId) {
      sink.add({
        ruleId: "ORATLAS-CITATION-001",
        severity: "warning",
        message: `Citation '${citation.value.id}' has no DOI, PMID, or OpenAlex identifier.`,
        path: citationPath,
        line: citation.line,
        suggestion:
          "Add a persistent identifier where one exists; retain the URL only as an access location.",
      });
    }
  }
  for (const relation of relations) {
    const pair = pairKey(relation.value.claimId, relation.value.citationId);
    relationPairs.add(pair);
    relatedClaimIds.add(relation.value.claimId);
    const missing = [
      !claimIds.has(relation.value.claimId) ? `claim '${relation.value.claimId}'` : undefined,
      !citationIds.has(relation.value.citationId)
        ? `citation '${relation.value.citationId}'`
        : undefined,
    ].filter(Boolean);
    if (missing.length > 0) {
      sink.add({
        ruleId: "ORATLAS-RELATION-001",
        severity: "error",
        message: `Relation references unknown ${missing.join(" and ")}.`,
        path: relationPath,
        line: relation.line,
        suggestion:
          "Use IDs declared in the claims and citations artifacts, or add the missing records.",
      });
    }
  }
  for (const claim of claims) {
    if (!relatedClaimIds.has(claim.value.id)) {
      sink.add({
        ruleId: "ORATLAS-CLAIM-002",
        severity: "warning",
        message: `Claim '${claim.value.id}' has no claim–citation relation.`,
        path: claimPath,
        line: claim.line,
        suggestion:
          "Add an evidence relation or explicitly qualify the claim as currently unsupported.",
      });
    }
  }
  for (const assessment of trust) {
    const pair = pairKey(assessment.value.claimId, assessment.value.citationId);
    if (!claimIds.has(assessment.value.claimId) || !citationIds.has(assessment.value.citationId)) {
      sink.add({
        ruleId: "ORATLAS-TRUST-001",
        severity: "error",
        message: `TRUST assessment '${pair}' references an unknown claim or citation.`,
        path: trustPath,
        line: assessment.line,
        suggestion: "Use IDs declared in the claims and citations artifacts.",
      });
    }
    if (!relationPairs.has(pair)) {
      sink.add({
        ruleId: "ORATLAS-TRUST-002",
        severity: "error",
        message: `TRUST assessment '${pair}' has no corresponding claim–citation relation.`,
        path: trustPath,
        line: assessment.line,
        suggestion:
          "Create the relation first; TRUST is relation-specific and never attaches to a citation globally.",
      });
    }
    for (const criterion of TRUST_CRITERIA) {
      const value = assessment.value.criteria[criterion];
      if (!value) {
        sink.add({
          ruleId: "ORATLAS-TRUST-003",
          severity: "warning",
          message: `TRUST assessment '${pair}' omits criterion '${criterion}'.`,
          path: trustPath,
          line: assessment.line,
          suggestion: `Add '${criterion}' with an assessed, not-assessed, or not-applicable status and rationale.`,
        });
        continue;
      }
      const expectedStatus =
        value.rating === "not-assessed"
          ? "not-assessed"
          : value.rating === "not-applicable"
            ? "not-applicable"
            : "assessed";
      if (value.status !== expectedStatus) {
        sink.add({
          ruleId: "ORATLAS-TRUST-004",
          severity: "warning",
          message: `TRUST criterion '${criterion}' has rating '${value.rating}' but status '${value.status}'.`,
          path: trustPath,
          line: assessment.line,
          suggestion: `Set status to '${expectedStatus}' so missingness is explicit and not converted into a score.`,
        });
      }
    }
    if (
      assessment.value.reviewStatus === "human-reviewed" ||
      assessment.value.reviewStatus === "adjudicated"
    ) {
      sink.add({
        ruleId: "ORATLAS-TRUST-005",
        severity: "notice",
        message: `Repository assertion '${assessment.value.reviewStatus}' is preserved as unverified input, not Atlas verification.`,
        path: trustPath,
        line: assessment.line,
        suggestion:
          "No source edit is required; an Atlas editor must create a separate verification marker after import.",
      });
    }
  }
}

function uniqueIds<T extends { id: string }>(
  sink: FindingSink,
  records: Located<T>[],
  path: string,
  label: string,
): Set<string> {
  const ids = new Set<string>();
  for (const record of records) {
    if (ids.has(record.value.id)) {
      sink.add({
        ruleId: "ORATLAS-ARTIFACT-004",
        severity: "error",
        message: `Duplicate ${label} ID '${record.value.id}'.`,
        path,
        line: record.line,
        suggestion: "Give every record a unique local ID and update its references.",
      });
    }
    ids.add(record.value.id);
  }
  return ids;
}

function pathFor<T>(records: Located<T>[], fallback: string): string {
  return records[0]?.path ?? fallback;
}

function pairKey(claimId: string, citationId: string): string {
  return `${claimId}→${citationId}`;
}

function addArtifactReadFailure(sink: FindingSink, path: string, result: ReadResult): void {
  sink.add({
    ruleId: result.status === "missing" ? "ORATLAS-ARTIFACT-001" : "ORATLAS-SECURITY-001",
    severity: "error",
    message:
      result.status === "missing"
        ? `Declared artifact '${path}' is missing.`
        : `Artifact '${path}' was rejected: ${result.detail ?? result.status}.`,
    path,
    suggestion:
      result.status === "missing"
        ? "Add the file or correct its manifest path."
        : "Use a regular, repository-contained text file within the documented size limits.",
  });
}

function addReadFailure(sink: FindingSink, path: string, result: ReadResult): void {
  sink.add({
    ruleId: "ORATLAS-SECURITY-001",
    severity: "error",
    message: `${path} was rejected: ${result.detail ?? result.status}.`,
    path,
    suggestion:
      "Use a regular, repository-contained UTF-8 text file within the documented size limits.",
  });
}

function lineOfJsonKey(content: string, key: string): number {
  const lines = content.split(/\r?\n/);
  const index = lines.findIndex((line) => line.includes(`"${key}"`));
  return index >= 0 ? index + 1 : 1;
}

function cleanText(value: string): string {
  // Preserve ordinary newlines for JSON while removing terminal-control input.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, 4_000);
}

function compareFindings(left: AtlasCheckFinding, right: AtlasCheckFinding): number {
  const severityOrder = { error: 0, warning: 1, notice: 2 } as const;
  return (
    severityOrder[left.severity] - severityOrder[right.severity] ||
    compareText(left.path ?? "", right.path ?? "") ||
    (left.line ?? 0) - (right.line ?? 0) ||
    compareText(left.ruleId, right.ruleId) ||
    compareText(left.message, right.message)
  );
}

/** Locale-independent UTF-16 ordering keeps reports stable across runners. */
function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
