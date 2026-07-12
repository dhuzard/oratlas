const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "is",
  "are",
  "was",
  "were",
  "be",
  "by",
  "that",
  "this",
  "it",
  "as",
  "at",
  "from",
  "into",
  "during",
  "which",
  "these",
  "those",
  "than",
  "then",
  "not",
  "no",
]);

/** Normalize free text to a comparable token list (lower-case, stopword-free). */
export function tokenize(text: string): string[] {
  const normalized = text
    .normalize("NFKD")
    .toLowerCase()
    // Fold accents only when they modify a Latin base character. Removing all
    // combining marks corrupts vowel signs and viramas in Indic scripts.
    .replace(/(\p{Script=Latin})\p{M}+/gu, "$1");

  return (
    normalized.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:-[\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu) ?? []
  )
    .map((token) => token.normalize("NFC"))
    .filter((token) => {
      const baseLength = token.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
      // Keep short scientific terms (AI, MS, AD, UK, 3R) and the R language,
      // while retaining the stopword filter for ordinary one/two-letter noise.
      const longEnough = baseLength >= 2 || token === "r";
      return longEnough && !STOPWORDS.has(token);
    });
}

export function tokenSet(text: string): Set<string> {
  return new Set(tokenize(text));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/** Simple lexical relevance: overlap of query tokens with a document. */
export function lexicalScore(queryTokens: string[], docTokens: Set<string>): number {
  if (queryTokens.length === 0) return 0;
  let hits = 0;
  for (const q of queryTokens) if (docTokens.has(q)) hits += 1;
  return hits / queryTokens.length;
}
