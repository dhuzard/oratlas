import {
  extractedMetadataSchema,
  type ExtractedMetadata,
  type ExtractionSource,
  type FieldProvenance,
  type InspectionReport,
} from "@oratlas/contracts";
import { EXTRACTOR_VERSION } from "./version.js";
import {
  parseCitationCff,
  parseCodemeta,
  parseManifest,
  parseMystConfig,
  parseReadme,
  parseZenodoJson,
  type ParsedSource,
} from "./sources.js";

/**
 * Deterministic extraction priority (spec §12). Highest first: a field is set
 * by the first source that provides it, and lower-priority sources never
 * overwrite it. Every set value records where it came from.
 */
interface SourceRun {
  source: ExtractionSource;
  file?: string;
  confidence: number;
  parsed: ParsedSource;
}

const FIELD_KEYS = [
  "title",
  "abstract",
  "license",
  "keywords",
  "domains",
  "reviewType",
  "language",
  "repositoryUrl",
  "publishedReviewUrl",
  "releaseTag",
  "versionDoi",
  "conceptDoi",
  "zenodoRecordId",
  "contact",
  "authors",
] as const;
type FieldKey = (typeof FIELD_KEYS)[number];

function fileContent(
  report: InspectionReport,
  ...names: string[]
): { path: string; content: string } | undefined {
  for (const name of names) {
    const f = report.files[name];
    if (f?.content) return { path: name, content: f.content };
  }
  return undefined;
}

export interface ExtractionResult {
  metadata: ExtractedMetadata;
  /** True when a valid review-manifest.json was found. */
  manifestPresent: boolean;
}

/**
 * Build the extracted-metadata document from an inspection report by running
 * each source in priority order and stamping field-level provenance.
 */
export function extractMetadata(
  report: InspectionReport,
  now: () => Date = () => new Date(),
): ExtractionResult {
  const warnings: string[] = [];
  const runs: SourceRun[] = [];
  let manifestPresent = false;

  // 1. review-manifest.json
  const manifestFile = fileContent(report, "review-manifest.json");
  if (manifestFile) {
    const { manifest, parsed } = parseManifest(manifestFile.content);
    manifestPresent = Boolean(manifest);
    runs.push({ source: "review-manifest", file: manifestFile.path, confidence: 1, parsed });
  }

  // 2. CITATION.cff
  const cff = fileContent(report, "CITATION.cff");
  if (cff) {
    runs.push({
      source: "citation-cff",
      file: cff.path,
      confidence: 0.95,
      parsed: parseCitationCff(cff.content),
    });
  }

  // 3. .zenodo.json
  const zenodo = fileContent(report, ".zenodo.json");
  if (zenodo) {
    runs.push({
      source: "zenodo-json",
      file: zenodo.path,
      confidence: 0.9,
      parsed: parseZenodoJson(zenodo.content),
    });
  }

  // 4. codemeta.json
  const codemeta = fileContent(report, "codemeta.json");
  if (codemeta) {
    runs.push({
      source: "codemeta",
      file: codemeta.path,
      confidence: 0.9,
      parsed: parseCodemeta(codemeta.content),
    });
  }

  // 5. MyST config
  const myst = fileContent(report, "myst.yml", "myst.yaml");
  if (myst) {
    runs.push({
      source: "myst-config",
      file: myst.path,
      confidence: 0.8,
      parsed: parseMystConfig(myst.content),
    });
  }

  // 6. repository metadata (from the inspection report itself)
  runs.push({
    source: "repository-metadata",
    confidence: 0.7,
    parsed: {
      repositoryUrl: report.repo.canonicalUrl,
      license: report.licenseSpdx ?? undefined,
      publishedReviewUrl: report.pagesUrl ?? report.homepageUrl ?? undefined,
      releaseTag: report.releases.find((r) => !r.isDraft)?.tagName,
      keywords: report.topics.length > 0 ? report.topics : undefined,
      abstract: report.description ?? undefined,
      warnings: [],
    },
  });

  // 7. README heuristics
  const readme = fileContent(report, "README.md", "readme.md", "Readme.md");
  if (readme) {
    runs.push({
      source: "readme",
      file: readme.path,
      confidence: 0.5,
      parsed: parseReadme(readme.content),
    });
  }

  // Collect DOIs discovered in release bodies (as a fallback for versionDoi).
  const releaseDoi = report.releases.flatMap((r) => r.bodyDois)[0];
  if (releaseDoi) {
    runs.push({
      source: "repository-metadata",
      confidence: 0.6,
      file: "releases",
      parsed: { versionDoi: releaseDoi, warnings: [] },
    });
  }

  const fields: Record<string, { value: unknown; provenance: FieldProvenance }> = {};
  for (const run of runs) {
    for (const w of run.parsed.warnings) warnings.push(`[${run.source}] ${w}`);
    for (const key of FIELD_KEYS) {
      if (key in fields) continue; // higher-priority already set it
      const value = (run.parsed as unknown as Record<string, unknown>)[key];
      if (value === undefined || value === null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      fields[key] = {
        value,
        provenance: {
          source: run.source,
          file: run.file,
          pointer: pointerFor(run.source, key),
          commitSha: report.latestCommitSha,
          extractorVersion: EXTRACTOR_VERSION,
          extractedAt: now().toISOString(),
          confidence: run.confidence,
          warnings: [],
        },
      };
    }
  }

  // commitSha field from inspection (always deterministic).
  if (report.latestCommitSha) {
    fields.commitSha = {
      value: report.latestCommitSha,
      provenance: {
        source: "repository-metadata",
        commitSha: report.latestCommitSha,
        extractorVersion: EXTRACTOR_VERSION,
        extractedAt: now().toISOString(),
        confidence: 1,
        warnings: [],
      },
    };
  }

  const metadata = extractedMetadataSchema.parse({
    extractorVersion: EXTRACTOR_VERSION,
    extractedAt: now().toISOString(),
    commitSha: report.latestCommitSha,
    fields,
    warnings,
  });

  return { metadata, manifestPresent };
}

function pointerFor(source: ExtractionSource, key: FieldKey): string | undefined {
  if (source === "review-manifest") {
    const map: Partial<Record<FieldKey, string>> = {
      title: "review.title",
      abstract: "review.abstract",
      keywords: "review.keywords",
      license: "review.license",
      repositoryUrl: "repository.url",
      releaseTag: "repository.releaseTag",
      publishedReviewUrl: "publication.reviewUrl",
      versionDoi: "publication.versionDoi",
      conceptDoi: "publication.conceptDoi",
      zenodoRecordId: "publication.zenodoRecordId",
    };
    return map[key];
  }
  return undefined;
}
