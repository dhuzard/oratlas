import type { StoredCompatibilityReport } from "./compatibility-report";

export const ARTIFACT_KINDS = [
  "claims",
  "citations",
  "relations",
  "trust",
  "nodes",
  "edges",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface ArtifactOutcomePresentation {
  artifact: ArtifactKind;
  state: "legacy" | "not-declared" | "invalid" | "loaded-empty" | "loaded" | "skipped";
  label: string;
  detail?: string;
  reasons: string[];
}

type ObjectValue = Record<string, unknown>;

function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}

function count(value: unknown): number | null | undefined {
  return value === null
    ? null
    : typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value
      : undefined;
}

function reasons(outcome: ObjectValue): string[] {
  if (!Array.isArray(outcome.sources)) return [];
  return outcome.sources.flatMap((source) => {
    const row = object(source);
    if (!row || !Array.isArray(row.issues)) return [];
    return row.issues.flatMap((issue) => {
      const value = object(issue);
      if (!value || typeof value.message !== "string") return [];
      const path = typeof row.path === "string" ? `${row.path}: ` : "";
      return [`${path}${value.message}`];
    });
  });
}

function declarationLabel(outcome: ObjectValue): "Declared" | "Discovered" {
  if (!Array.isArray(outcome.sources)) return "Declared";
  const discoveries = outcome.sources
    .map(object)
    .map((source) => source?.discovery)
    .filter((value): value is string => typeof value === "string");
  return discoveries.length > 0 && discoveries.every((value) => value === "discovered")
    ? "Discovered"
    : "Declared";
}

function detailForCounts(loaded: number, skipped: number | null | undefined): string {
  const loadedText = `${loaded} record${loaded === 1 ? "" : "s"} loaded`;
  if (skipped === null) return `${loadedText}; skipped count unavailable`;
  if (skipped && skipped > 0) {
    return `${loadedText}; ${skipped} record${skipped === 1 ? "" : "s"} skipped`;
  }
  return loadedText;
}

export function presentArtifactOutcomes(
  report: StoredCompatibilityReport | undefined,
  only: readonly ArtifactKind[] = ARTIFACT_KINDS,
): ArtifactOutcomePresentation[] {
  const outcomes = object(report?.artifactOutcomes);
  if (report?.schemaVersion !== "1.1.0" || !outcomes) {
    return only.map((artifact) => ({
      artifact,
      state: "legacy",
      label: "Unknown — report predates per-artifact outcomes",
      reasons: [],
    }));
  }

  return only.map((artifact) => {
    const outcome = object(outcomes[artifact]);
    const status = outcome?.status;
    const loaded = count(outcome?.loadedCount) ?? 0;
    const skipped = count(outcome?.skippedCount);
    const issueReasons = outcome ? reasons(outcome) : [];

    if (status === "not-declared") {
      return { artifact, state: "not-declared", label: "Not declared", reasons: [] };
    }
    if (status === "invalid") {
      return {
        artifact,
        state: "invalid",
        label: "Declared but invalid",
        detail: detailForCounts(loaded, skipped),
        reasons: issueReasons,
      };
    }
    if (status === "loaded") {
      const origin = outcome ? declarationLabel(outcome) : "Declared";
      return loaded === 0 && (skipped === 0 || skipped === undefined)
        ? {
            artifact,
            state: "loaded-empty",
            label: `${origin} and loaded — empty`,
            detail: detailForCounts(loaded, skipped),
            reasons: issueReasons,
          }
        : {
            artifact,
            state: "loaded",
            label: "Loaded",
            detail: detailForCounts(loaded, skipped),
            reasons: issueReasons,
          };
    }
    if (status === "skipped") {
      return {
        artifact,
        state: "skipped",
        label: "Skipped / unavailable",
        detail: detailForCounts(loaded, skipped),
        reasons: issueReasons,
      };
    }
    return {
      artifact,
      state: "legacy",
      label: "Unknown — report predates per-artifact outcomes",
      reasons: [],
    };
  });
}
