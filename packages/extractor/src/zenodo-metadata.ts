import {
  extractedMetadataSchema,
  type CompatibilityReport,
  type ExtractedMetadata,
  type FieldProvenance,
  type InspectionReport,
} from "@oratlas/contracts";
import { normalizeDoi, type ZenodoRecord } from "@oratlas/zenodo";

interface ZenodoField {
  value: string;
  pointer: string;
  confidence?: number;
}

/**
 * Add metadata discovered through an exact repository-URL match in Zenodo.
 * Repository-declared values retain priority and are never overwritten.
 */
export function enrichMetadataFromZenodo(
  metadata: ExtractedMetadata,
  report: InspectionReport,
  record: ZenodoRecord,
  now: () => Date = () => new Date(),
): ExtractedMetadata {
  const additions: Partial<Record<string, ZenodoField>> = {};
  const versionDoi = normalizeDoi(record.doi ?? "");
  const conceptDoi = normalizeDoi(record.conceptDoi ?? "");

  if (versionDoi.ok && versionDoi.doi && !metadata.fields.versionDoi) {
    additions.versionDoi = { value: versionDoi.doi, pointer: "metadata.doi", confidence: 1 };
  }
  if (conceptDoi.ok && conceptDoi.doi && !metadata.fields.conceptDoi) {
    additions.conceptDoi = {
      value: conceptDoi.doi,
      pointer: "conceptdoi",
      confidence: 1,
    };
  }
  if (/^\d+$/.test(record.recordId) && !metadata.fields.zenodoRecordId) {
    additions.zenodoRecordId = {
      value: record.recordId,
      pointer: "id",
      confidence: 1,
    };
  }

  const versionTag = record.versionTag;
  const matchingTag = versionTag
    ? report.tags.find((tag) => normalizeTag(tag.name) === normalizeTag(versionTag))?.name
    : undefined;
  if (matchingTag && !metadata.fields.releaseTag) {
    additions.releaseTag = {
      value: matchingTag,
      pointer: "metadata.version",
      confidence: 0.95,
    };
  }

  if (Object.keys(additions).length === 0) return metadata;

  const extractedAt = now().toISOString();
  const fields: Record<string, unknown> = { ...metadata.fields };
  for (const [key, addition] of Object.entries(additions)) {
    if (!addition) continue;
    const provenance: FieldProvenance = {
      source: "zenodo-api",
      pointer: addition.pointer,
      extractorVersion: metadata.extractorVersion,
      extractedAt,
      confidence: addition.confidence ?? 1,
      warnings: [],
    };
    fields[key] = { value: addition.value, provenance };
  }

  return extractedMetadataSchema.parse({
    ...metadata,
    fields,
  });
}

function normalizeTag(value: string): string {
  return value.trim().replace(/^v/i, "").toLowerCase();
}

/** Keep the compatibility summary aligned with DOI fields added after repository extraction. */
export function enrichCompatibilityFromZenodo<T extends CompatibilityReport>(
  compatibility: T,
  metadata: ExtractedMetadata,
): T {
  const record = metadata.fields.zenodoRecordId;
  const versionDoi = metadata.fields.versionDoi;
  if (record?.provenance.source !== "zenodo-api" || !versionDoi) return compatibility;

  return {
    ...compatibility,
    doiDetected: {
      detected: true,
      evidence: [`Zenodo record ${record.value} matched the exact GitHub repository URL.`],
    },
    recommendations: compatibility.recommendations.filter(
      (recommendation) => !recommendation.startsWith("Connect the repository to Zenodo"),
    ),
  } as T;
}
