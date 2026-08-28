/**
 * Resolving locations inside a published publication.
 *
 * Two different bases are in play and conflating them is the classic bug:
 *
 * - **Artifact paths** (`artifacts.claims.path`, `adapter.xref`) are relative
 *   to the artifact that declares them — the manifest, which the producer
 *   contract requires to be served at the publication root.
 * - **Cross-reference inventory URLs** are *site-root-relative absolute paths*
 *   (`/`, `/results`), not paths relative to the publication.
 *
 * Resolving an inventory URL directly against a canonical URL with a path
 * component silently discards that path, which every subpath deployment hits:
 *
 * ```js
 * new URL("/results", "https://example.org/review/").href;
 * // → "https://example.org/results"   ← the /review/ prefix is gone
 * ```
 *
 * The producer contract's normative rule is therefore: treat the canonical URL
 * as the site root, append a trailing `/` if absent, strip leading `/`
 * characters from the inventory URL, and resolve the remainder against it.
 */

/** A base URL a relative path can safely be resolved against. */
export function publicationSiteRoot(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.hash = "";
  url.search = "";
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

/**
 * Site root a manifest was actually observed at.
 *
 * The manifest is served at the publication root, so its own directory is that
 * root. This is the base every artifact is fetched from — never the declared
 * `canonicalUrl`, which the producer contract forbids dereferencing during
 * validation.
 */
export function observedSiteRoot(manifestUrl: string): string {
  const url = new URL(manifestUrl);
  url.hash = "";
  url.search = "";
  const segments = url.pathname.split("/");
  segments.pop();
  url.pathname = `${segments.join("/")}/`;
  return url.href;
}

/**
 * Absolute location of a declared publication-relative artifact path.
 *
 * The path must already have passed the safe-path rule: it has no leading `/`,
 * no `.` or `..` segment and no scheme, so the result cannot escape the root.
 * The check is repeated here anyway, because a resolver that trusts its caller
 * is one refactor away from being the hole.
 */
export function resolveArtifactUrl(siteRootUrl: string, declaredPath: string): string {
  const root = publicationSiteRoot(siteRootUrl);
  const resolved = new URL(declaredPath, root);
  if (!resolved.href.startsWith(root)) {
    throw new Error("A declared artifact path resolved outside the publication root.");
  }
  return resolved.href;
}

/**
 * Resolve a cross-reference inventory URL against the publication's site root,
 * optionally attaching the target's fragment.
 *
 * This is the normative rule from the producer contract; see the module note
 * for why the naive form is wrong.
 */
export function resolvePublishedUrl(
  siteRootUrl: string,
  inventoryUrl: string,
  htmlId?: string,
): string {
  const base = publicationSiteRoot(siteRootUrl);
  const relative = inventoryUrl.replace(/^\/+/, "");
  const url = new URL(relative, base);
  if (htmlId !== undefined && htmlId.length > 0) url.hash = htmlId;
  return url.href;
}
