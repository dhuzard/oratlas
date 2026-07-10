export interface DoiNormalizeResult {
  ok: boolean;
  doi?: string;
  reason?: string;
}

/**
 * Normalize the many textual forms of a DOI to the bare `10.xxxx/suffix` form
 * (spec §3): accepts `doi:10...`, `DOI: 10...`, `https://doi.org/10...`,
 * `http://dx.doi.org/10...`, and raw `10...`.
 */
export function normalizeDoi(input: string): DoiNormalizeResult {
  if (typeof input !== "string") return { ok: false, reason: "DOI must be a string." };
  let s = input.trim();
  if (s.length === 0) return { ok: false, reason: "DOI is empty." };
  if (s.length > 500) return { ok: false, reason: "DOI is too long." };

  // Strip URL resolver prefixes.
  s = s.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  s = s.replace(/^https?:\/\/(www\.)?doi\.org\//i, "");
  // Strip a leading "doi:" or "DOI " label.
  s = s.replace(/^doi:\s*/i, "");
  s = s.replace(/^doi\s+/i, "");
  s = s.trim();
  // Trim trailing punctuation that often trails DOIs in prose.
  s = s.replace(/[.,;:\s]+$/, "");

  const match = /^10\.\d{4,9}\/\S+$/.exec(s);
  if (!match) return { ok: false, reason: "Not a syntactically valid DOI." };
  // DOIs are case-insensitive; normalize to lower-case for comparison/storage.
  return { ok: true, doi: s.toLowerCase() };
}

const ZENODO_DOI_RE = /^10\.5281\/zenodo\.(\d+)$/i;

export function isZenodoDoi(doi: string): boolean {
  return ZENODO_DOI_RE.test(doi);
}

/** Extract the Zenodo record id from a Zenodo DOI, if it is one. */
export function zenodoRecordIdFromDoi(doi: string): string | undefined {
  const m = ZENODO_DOI_RE.exec(doi);
  return m ? m[1] : undefined;
}

/**
 * Reserved documentation DOI prefixes used by our own seed/example data.
 * These must never be resolved outward.
 */
export function isExampleDoi(doi: string): boolean {
  return /^10\.5555\//i.test(doi);
}
