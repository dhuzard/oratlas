/**
 * Durable evidence identities.
 *
 * Source repositories only promise that claim/citation ids are unique inside
 * one review version. Atlas therefore namespaces them with the immutable
 * ReviewVersion id before they cross a repository boundary.
 */

export type WorkIdentifierScheme = "doi" | "pmid" | "openalex";
export type CanonicalWorkAlias = `${WorkIdentifierScheme}:${string}`;

export interface WorkIdentifierInput {
  doi?: string;
  pmid?: string;
  openAlexId?: string;
}

export interface WorkIdentityAssertion {
  citationIds: string[];
  scheme: WorkIdentifierScheme;
  values: string[];
  message: string;
}

/**
 * Encode every UTF-16 code unit as exactly four lowercase hexadecimal digits.
 * Iterating code units (rather than Unicode code points) makes this total and
 * injective for every JavaScript string, including unpaired surrogates.
 */
export function encodeUtf16Component(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index++) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return encoded;
}

export function decodeUtf16Component(encoded: string): string {
  if (!/^(?:[0-9a-f]{4})*$/.test(encoded)) {
    throw new Error("Encoded UTF-16 component must contain complete lowercase hex code units.");
  }
  let decoded = "";
  for (let index = 0; index < encoded.length; index += 4) {
    decoded += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 4), 16));
  }
  return decoded;
}

function scopedEvidenceId(
  kind: "claim" | "citation",
  reviewVersionId: string,
  localId: string,
): string {
  return `oratlas:${kind}:v1:${encodeUtf16Component(reviewVersionId)}:${encodeUtf16Component(localId)}`;
}

export function globalClaimId(reviewVersionId: string, localClaimId: string): string {
  return scopedEvidenceId("claim", reviewVersionId, localClaimId);
}

export function globalCitationId(reviewVersionId: string, localCitationId: string): string {
  return scopedEvidenceId("citation", reviewVersionId, localCitationId);
}

/** Platform-owned, collision-free DOM id. Repository-provided anchors are data, not DOM ids. */
export function claimDomAnchor(reviewVersionId: string, localClaimId: string): string {
  return `oratlas-claim-v1-${encodeUtf16Component(reviewVersionId)}-${encodeUtf16Component(localClaimId)}`;
}

export function canonicalizeDoi(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .replace(/^doi:\s*/i, "")
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .trim()
    .toLowerCase();
  return /^10\.\d{4,9}\/\S+$/.test(normalized) ? normalized : undefined;
}

export function canonicalizePmid(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .replace(/^pmid:\s*/i, "")
    .replace(/^https?:\/\/(?:www\.)?pubmed\.ncbi\.nlm\.nih\.gov\//i, "")
    .replace(/\/$/, "");
  if (!/^\d{1,9}$/.test(normalized)) return undefined;
  return normalized.replace(/^0+(?=\d)/, "");
}

export function canonicalizeOpenAlexId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value
    .trim()
    .replace(/^openalex:\s*/i, "")
    .replace(/^https?:\/\/(?:www\.)?openalex\.org\//i, "")
    .replace(/\/$/, "")
    .toUpperCase();
  return /^W\d+$/.test(normalized) ? normalized : undefined;
}

/** Canonical aliases are comparison keys, never resolver URLs. */
export function canonicalWorkAliases(input: WorkIdentifierInput): CanonicalWorkAlias[] {
  const aliases: CanonicalWorkAlias[] = [];
  const doi = canonicalizeDoi(input.doi);
  const pmid = canonicalizePmid(input.pmid);
  const openAlexId = canonicalizeOpenAlexId(input.openAlexId);
  if (doi) aliases.push(`doi:${doi}`);
  if (pmid) aliases.push(`pmid:${pmid}`);
  if (openAlexId) aliases.push(`openalex:${openAlexId}`);
  return aliases;
}

/**
 * Detect contradictory identifier assertions in connected alias clusters.
 * Example: two citations share a PMID but assert different DOIs. We keep both
 * records, surface the conflict, and refuse to silently treat the cluster as a
 * clean identity assertion.
 */
export function findWorkIdentifierConflicts(
  records: Array<{ citationId: string; aliases: CanonicalWorkAlias[] }>,
): WorkIdentityAssertion[] {
  const parent = records.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]!]!;
      index = parent[index]!;
    }
    return index;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const firstByAlias = new Map<string, number>();
  records.forEach((record, index) => {
    for (const alias of record.aliases) {
      const first = firstByAlias.get(alias);
      if (first === undefined) firstByAlias.set(alias, index);
      else union(first, index);
    }
  });

  const groups = new Map<number, number[]>();
  records.forEach((_, index) => {
    const root = find(index);
    groups.set(root, [...(groups.get(root) ?? []), index]);
  });

  const conflicts: WorkIdentityAssertion[] = [];
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    for (const scheme of ["doi", "pmid", "openalex"] as const) {
      const values = new Set<string>();
      for (const index of indexes) {
        for (const alias of records[index]!.aliases) {
          if (alias.startsWith(`${scheme}:`)) values.add(alias.slice(scheme.length + 1));
        }
      }
      if (values.size < 2) continue;
      const sortedValues = [...values].sort();
      const citationIds = indexes.map((index) => records[index]!.citationId).sort();
      conflicts.push({
        citationIds,
        scheme,
        values: sortedValues,
        message: `Conflicting ${scheme.toUpperCase()} assertions (${sortedValues.join(", ")}) occur in a shared scholarly-work alias cluster.`,
      });
    }
  }
  return conflicts.sort((left, right) =>
    `${left.scheme}:${left.citationIds.join("|")}`.localeCompare(
      `${right.scheme}:${right.citationIds.join("|")}`,
    ),
  );
}
