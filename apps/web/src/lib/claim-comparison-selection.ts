export type ExactClaimComparisonReference =
  | { kind: "review"; versionId: string; localClaimId: string }
  | { kind: "external"; occurrenceId: string }
  | { kind: "node"; nodeId: string; nodeVersionId: string };

/** Local exact-version paths only: no external fetch, latest alias or inferred identity. */
export function parseClaimComparisonReference(
  reference: string,
): ExactClaimComparisonReference | null {
  if (reference.length > 1600 || /[?#\\]/.test(reference)) return null;
  const match = /^\/claims\/([^/]+)\/([^/]+)$/.exec(reference);
  const node = /^\/nodes\/([^/]+)\/versions\/([^/]+)$/.exec(reference);
  const external = /^\/api\/publication-claim-occurrences\/([^/]+)$/.exec(reference);
  if (!match && !node && !external) return null;
  try {
    const parts = (match ?? node ?? external)!.slice(1).map(decodeURIComponent);
    if (
      parts.some(
        (part) =>
          !part ||
          part.length > 300 ||
          /[/\\]/.test(part) ||
          [...part].some((character) => character.charCodeAt(0) < 32),
      )
    ) {
      return null;
    }
    return external
      ? { kind: "external", occurrenceId: parts[0]! }
      : match
        ? { kind: "review", versionId: parts[0]!, localClaimId: parts[1]! }
        : { kind: "node", nodeId: parts[0]!, nodeVersionId: parts[1]! };
  } catch {
    return null;
  }
}

export interface ClaimComparisonSelection {
  compareLeft?: string;
  replaceSide?: "first" | "second";
}

type SearchParams = Record<string, string | string[] | undefined>;

/** Syntax only: the server must recheck public visibility before displaying either claim. */
export function readClaimComparisonSelection(params: SearchParams): ClaimComparisonSelection {
  const { compareLeft, replaceSide } = params;
  if (replaceSide !== undefined && replaceSide !== "first" && replaceSide !== "second") return {};
  return {
    ...(typeof compareLeft === "string" && parseClaimComparisonReference(compareLeft)
      ? { compareLeft }
      : {}),
    ...(replaceSide ? { replaceSide } : {}),
  };
}

/** Preserve collection filters and legacy review comparison parameters verbatim in meaning. */
export function withClaimComparisonSelection(
  href: string,
  selection: ClaimComparisonSelection,
): string {
  if (
    !href.startsWith("/") ||
    href.startsWith("//") ||
    href.includes("\\") ||
    [...href].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new Error("Comparison selection links require a local path.");
  }
  const url = new URL(href, "https://oratlas.invalid");
  for (const key of ["compareLeft", "replaceSide"] as const) {
    url.searchParams.delete(key);
  }
  const bounded = readClaimComparisonSelection({ ...selection });
  for (const key of ["compareLeft", "replaceSide"] as const) {
    if (bounded[key]) url.searchParams.set(key, bounded[key]);
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
