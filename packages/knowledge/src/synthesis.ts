import { canonicalWorkAliases, type CanonicalWorkAlias } from "@oratlas/contracts";

/**
 * Independence-aware synthesis (issue #5). Every judgement here is a
 * deterministic rule over declared identifiers and stored relations — never a
 * model decision. The goal is to prevent false consensus: counting the same
 * underlying source twice, or reading a scope difference as a contradiction.
 */

export interface SynthesisCitation {
  /** Stable id of the citation row (unique per review version). */
  citationId: string;
  doi?: string;
  pmid?: string;
  openAlexId?: string;
  title?: string;
  year?: number;
  /** Normalized dataset/cohort accessions the work declares it uses. */
  datasetIds: string[];
  /** DOIs of works this one is a derivative analysis of. */
  derivedFromDois: string[];
  isExample: boolean;
}

export interface SynthesisStatement {
  /** Version-scoped global claim id. */
  claimId: string;
  reviewSlug: string;
  reviewVersionId: string;
  localClaimId: string;
  text: string;
  /** Declared structured scope, when the repository provided one. */
  scope?: ClaimScope;
  evidence: Array<{
    citationId: string;
    relationType: string;
    supportDirection?: string;
  }>;
}

export interface ClaimScope {
  population?: string;
  model?: string;
  intervention?: string;
  outcome?: string;
  method?: string;
}

export const SCOPE_FIELDS = ["population", "model", "intervention", "outcome", "method"] as const;

/** Archived review version DOIs, for circular-citation detection. */
export interface ArchivedReviewDoi {
  doi: string;
  reviewSlug: string;
}

const OPPOSING_RELATIONS = new Set(["contradicts"]);
const SUPPORTING_RELATIONS = new Set(["supports", "partially-supports"]);

function normalizeToken(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Low-entropy dataset labels ("controls", "n/a", …) are not identifiers and
 * must never union unrelated works into one evidence family. Only tokens that
 * look like a namespaced accession (a prefix, or a digit-bearing code) group
 * works together.
 */
function isGroupingDatasetToken(token: string): boolean {
  if (token.length < 4) return false;
  return /[:/]/.test(token) || (/\d/.test(token) && /[a-z]/.test(token)) || /^\d{4,}$/.test(token);
}

/** Primary canonical alias of a citation, or a citation-scoped fallback. */
export function workKey(citation: SynthesisCitation): string {
  const aliases = canonicalWorkAliases({
    doi: citation.doi,
    pmid: citation.pmid,
    openAlexId: citation.openAlexId,
  });
  return aliases[0] ?? `citation:${citation.citationId}`;
}

/**
 * Union-find over works: two works belong to one evidence family when they
 * share a declared dataset/cohort or one is a derivative analysis of the
 * other. Independent evidence is counted in families, not citations.
 */
export function evidenceFamilies(citations: SynthesisCitation[]): Map<string, string> {
  const keys = new Map<string, SynthesisCitation[]>();
  for (const citation of citations) {
    const key = workKey(citation);
    keys.set(key, [...(keys.get(key) ?? []), citation]);
  }
  const workKeys = [...keys.keys()];
  const parent = new Map<string, string>(workKeys.map((key) => [key, key]));
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root)!;
    let cursor = key;
    while (parent.get(cursor) !== cursor) {
      const next = parent.get(cursor)!;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  const byDataset = new Map<string, string>();
  const doiToKey = new Map<string, string>();
  for (const [key, group] of keys) {
    for (const citation of group) {
      const aliases = canonicalWorkAliases({ doi: citation.doi });
      for (const alias of aliases) doiToKey.set(alias, key);
    }
  }
  for (const [key, group] of keys) {
    for (const citation of group) {
      for (const dataset of citation.datasetIds) {
        const token = normalizeToken(dataset);
        if (!isGroupingDatasetToken(token)) continue;
        const existing = byDataset.get(token);
        if (existing) union(existing, key);
        else byDataset.set(token, key);
      }
      for (const derivedFrom of citation.derivedFromDois) {
        const aliases = canonicalWorkAliases({ doi: derivedFrom });
        const targetKey = aliases[0] ? doiToKey.get(aliases[0]) : undefined;
        if (targetKey) union(targetKey, key);
      }
    }
  }

  const result = new Map<string, string>();
  for (const key of workKeys) result.set(key, find(key));
  return result;
}

/** Citation DOIs that point back at archived review versions. */
export function circularCitations(
  citations: SynthesisCitation[],
  archivedDois: ArchivedReviewDoi[],
): Map<string, string> {
  const archiveByAlias = new Map<CanonicalWorkAlias, string>();
  for (const archived of archivedDois) {
    for (const alias of canonicalWorkAliases({ doi: archived.doi })) {
      archiveByAlias.set(alias, archived.reviewSlug);
    }
  }
  const circular = new Map<string, string>();
  for (const citation of citations) {
    for (const alias of canonicalWorkAliases({ doi: citation.doi })) {
      const slug = archiveByAlias.get(alias);
      if (slug) circular.set(citation.citationId, slug);
    }
  }
  return circular;
}

export interface IndependenceSummary {
  /** Distinct cited works supporting the statement. */
  supportingWorks: number;
  /** Independent evidence families behind those works. */
  independentSupportingFamilies: number;
  opposingWorks: number;
  independentOpposingFamilies: number;
  /** Work keys used by more than one statement in the compared set. */
  sharedWorkKeys: string[];
  /** Citations that point back into the archive (never independent). */
  circularCitationIds: string[];
}

export interface StatementSynthesis {
  claimId: string;
  summary: IndependenceSummary;
}

export interface ContradictionEntry {
  claimIdA: string;
  claimIdB: string;
  /**
   * All kinds require the two claims to read at least one *shared* evidence
   * family in opposite directions — claims whose evidence never overlaps are
   * about different things, not contradictions.
   * genuine-contradiction: opposite directions, both claims declare scope, and
   *   no declared field differs — a real disagreement;
   * scope-difference: opposite directions, but a declared scope field differs,
   *   so the statements may answer different questions;
   * undetermined-scope: opposite directions, but at least one claim declared no
   *   scope, so a scope difference can neither be confirmed nor ruled out.
   */
  kind: "genuine-contradiction" | "scope-difference" | "undetermined-scope";
  /** Number of evidence families the two claims read in opposite directions. */
  sharedFamilyCount: number;
  differingScopeFields: string[];
}

export interface SynthesisResult {
  statements: StatementSynthesis[];
  contradictions: ContradictionEntry[];
  familyByWorkKey: Map<string, string>;
  circularByCitationId: Map<string, string>;
}

function statementDirection(evidence: SynthesisStatement["evidence"][number]): 1 | -1 | 0 {
  if (OPPOSING_RELATIONS.has(evidence.relationType)) return -1;
  if (evidence.supportDirection === "negative") return -1;
  if (SUPPORTING_RELATIONS.has(evidence.relationType)) return 1;
  return 0;
}

export function differingScopeFields(a?: ClaimScope, b?: ClaimScope): string[] {
  if (!a || !b) return [];
  const differing: string[] = [];
  for (const field of SCOPE_FIELDS) {
    const left = a[field] ? normalizeToken(a[field]!) : undefined;
    const right = b[field] ? normalizeToken(b[field]!) : undefined;
    if (left && right && left !== right) differing.push(field);
  }
  return differing;
}

/**
 * Deterministic synthesis over a set of statements and their cited works:
 * independence-aware counts per statement plus a contradiction map that
 * separates genuine disagreement from scope differences and shared-source
 * repetition.
 */
export function synthesize(
  statements: SynthesisStatement[],
  citations: SynthesisCitation[],
  archivedDois: ArchivedReviewDoi[] = [],
): SynthesisResult {
  const citationById = new Map(citations.map((citation) => [citation.citationId, citation]));
  const familyByWorkKey = evidenceFamilies(citations);
  const circularByCitationId = circularCitations(citations, archivedDois);

  const workUse = new Map<string, Set<string>>();
  const directionFamilies: Array<{ supporting: Set<string>; opposing: Set<string> }> = [];
  const perStatement: StatementSynthesis[] = statements.map((statement, statementIndex) => {
    const supportingWorkKeys = new Set<string>();
    const opposingWorkKeys = new Set<string>();
    const circularIds = new Set<string>();
    for (const evidence of statement.evidence) {
      const citation = citationById.get(evidence.citationId);
      if (!citation) continue;
      const key = workKey(citation);
      workUse.set(key, (workUse.get(key) ?? new Set()).add(statement.claimId));
      if (circularByCitationId.has(citation.citationId)) {
        circularIds.add(citation.citationId);
        continue;
      }
      const direction = statementDirection(evidence);
      if (direction === 1) supportingWorkKeys.add(key);
      else if (direction === -1) opposingWorkKeys.add(key);
    }
    const families = (keys: Set<string>) =>
      new Set([...keys].map((key) => familyByWorkKey.get(key) ?? key));
    const supportingFamilies = families(supportingWorkKeys);
    const opposingFamilies = families(opposingWorkKeys);
    directionFamilies[statementIndex] = {
      supporting: supportingFamilies,
      opposing: opposingFamilies,
    };
    return {
      claimId: statement.claimId,
      summary: {
        supportingWorks: supportingWorkKeys.size,
        independentSupportingFamilies: supportingFamilies.size,
        opposingWorks: opposingWorkKeys.size,
        independentOpposingFamilies: opposingFamilies.size,
        sharedWorkKeys: [],
        circularCitationIds: [...circularIds].sort(),
      },
    };
  });

  const sharedKeys = new Set(
    [...workUse.entries()].filter(([, users]) => users.size > 1).map(([key]) => key),
  );
  for (const [index, statement] of statements.entries()) {
    const used = new Set<string>();
    for (const evidence of statement.evidence) {
      const citation = citationById.get(evidence.citationId);
      if (citation) used.add(workKey(citation));
    }
    perStatement[index]!.summary.sharedWorkKeys = [...used].filter((key) => sharedKeys.has(key));
  }

  // Index statements by evidence family and direction. This avoids comparing
  // every claim pair when their evidence is disjoint; work is proportional to
  // declared relations plus the contradiction pairs that must be returned.
  const useByFamily = new Map<string, { supporting: number[]; opposing: number[] }>();
  for (const [statementIndex, directions] of directionFamilies.entries()) {
    for (const family of directions.supporting) {
      const use = useByFamily.get(family) ?? { supporting: [], opposing: [] };
      use.supporting.push(statementIndex);
      useByFamily.set(family, use);
    }
    for (const family of directions.opposing) {
      const use = useByFamily.get(family) ?? { supporting: [], opposing: [] };
      use.opposing.push(statementIndex);
      useByFamily.set(family, use);
    }
  }

  const oppositeFamiliesByPair = new Map<
    string,
    { left: number; right: number; count: number; lastFamilyIndex: number }
  >();
  let familyIndex = 0;
  for (const use of useByFamily.values()) {
    for (const supportingIndex of use.supporting) {
      for (const opposingIndex of use.opposing) {
        if (supportingIndex === opposingIndex) continue;
        const left = Math.min(supportingIndex, opposingIndex);
        const right = Math.max(supportingIndex, opposingIndex);
        const key = `${left}\u0000${right}`;
        const pair = oppositeFamiliesByPair.get(key);
        if (pair) {
          if (pair.lastFamilyIndex !== familyIndex) {
            pair.count += 1;
            pair.lastFamilyIndex = familyIndex;
          }
        } else {
          oppositeFamiliesByPair.set(key, { left, right, count: 1, lastFamilyIndex: familyIndex });
        }
      }
    }
    familyIndex += 1;
  }

  const contradictions: ContradictionEntry[] = [...oppositeFamiliesByPair.values()]
    .sort((left, right) => left.left - right.left || left.right - right.right)
    .map(({ left, right, count }) => {
      const a = statements[left]!;
      const b = statements[right]!;
      const scopeDiff = differingScopeFields(a.scope, b.scope);
      const kind =
        scopeDiff.length > 0
          ? "scope-difference"
          : a.scope && b.scope
            ? "genuine-contradiction"
            : "undetermined-scope";
      return {
        claimIdA: a.claimId,
        claimIdB: b.claimId,
        kind,
        sharedFamilyCount: count,
        differingScopeFields: scopeDiff,
      };
    });

  return { statements: perStatement, contradictions, familyByWorkKey, circularByCitationId };
}
