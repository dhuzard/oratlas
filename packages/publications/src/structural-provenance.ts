import type { PublicationStructuralProvenance } from "@oratlas/contracts";

/**
 * Structural provenance is what ORAtlas actually checked about a publication's
 * published protocol structure and, where obtainable, its source bytes.
 *
 * It is **not** a scientific validation state. Reaching either level says
 * nothing about whether a claim is correct, supported, replicated, endorsed or
 * peer reviewed, and no caller may relabel it as such. TRUST remains separate
 * and attaches to a claim–citation relation.
 */

/** Checks available from the published site alone. All are required for level 1. */
export interface PublishedStructureChecks {
  /** Declared artifact digests were recomputed from the observed bytes and matched. */
  artifactDigestsMatched: boolean;
  /** Declared record counts matched the artifact actually read. */
  declaredRecordCountsMatched: boolean;
  /** Every declared path was re-validated against the safe-path rule before use. */
  declaredPathsRevalidated: boolean;
  /** Every declared claim target resolved in the publication's own inventory. */
  targetsResolvedInInventory: boolean;
}

/** Additional checks that need the publication's source bytes. All are required for level 2. */
export interface SourceByteChecks {
  /** Declared document and block digests matched the obtained source bytes. */
  sourceDigestsMatched: boolean;
  /** Declaration digests were recomputed from the obtained declarations and matched. */
  declarationDigestsRecomputed: boolean;
  /** Source-frame selectors located their exact quoted spans in the source bytes. */
  sourceSelectorsLocated: boolean;
}

export interface StructuralProvenanceChecks extends PublishedStructureChecks {
  /** Omitted when the publication declared no obtainable source. */
  sourceBytes?: SourceByteChecks;
}

/**
 * The structural provenance level these checks reached, or `null` when not even
 * the published structure verified. Fails closed: a partially satisfied level
 * is not that level.
 */
export function reachedStructuralProvenance(
  checks: StructuralProvenanceChecks,
): PublicationStructuralProvenance | null {
  const publishedStructure =
    checks.artifactDigestsMatched &&
    checks.declaredRecordCountsMatched &&
    checks.declaredPathsRevalidated &&
    checks.targetsResolvedInInventory;
  if (!publishedStructure) return null;
  const source = checks.sourceBytes;
  if (
    source !== undefined &&
    source.sourceDigestsMatched &&
    source.declarationDigestsRecomputed &&
    source.sourceSelectorsLocated
  ) {
    return "source-byte";
  }
  return "published-structure";
}
