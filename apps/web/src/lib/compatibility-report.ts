import { compatibilityReportSchema } from "@oratlas/contracts";

/** A stored compatibility report is public inspection evidence, but legacy rows may predate it. */
export type StoredCompatibilityReport = Record<string, unknown>;

function object(value: unknown): StoredCompatibilityReport | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as StoredCompatibilityReport)
    : undefined;
}

function parseObjectJson(value: string | null | undefined): StoredCompatibilityReport | undefined {
  if (!value) return undefined;
  try {
    return object(JSON.parse(value));
  } catch {
    return undefined;
  }
}

/**
 * Resolve the immutable version report first, falling back to legacy snapshot storage.
 * Unknown shapes are withheld so corrupt metadata cannot create misleading UI claims.
 */
export function compatibilityReportFromStoredJson(
  metadataJson: string | null | undefined,
  inspectionReportJson?: string | null,
): StoredCompatibilityReport | undefined {
  const metadata = parseObjectJson(metadataJson);
  const direct = object(metadata?.compatibilityReport);
  if (direct) {
    const parsed = compatibilityReportSchema.safeParse(direct);
    if (parsed.success) return parsed.data;
  }

  const inspection = parseObjectJson(inspectionReportJson);
  const legacy = object(inspection?.compatibilityReport);
  if (!legacy) return undefined;
  const parsed = compatibilityReportSchema.safeParse(legacy);
  return parsed.success ? parsed.data : undefined;
}
