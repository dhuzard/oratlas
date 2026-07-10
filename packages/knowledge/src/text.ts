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
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
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
