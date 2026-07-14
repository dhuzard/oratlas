/**
 * API contract drift check.
 *
 * Compares the endpoints declared in `docs/openapi.yaml` against the Next.js
 * App Router route handlers under `apps/web/src/app/api`. Fails (exit 1) when a
 * real route has no documented counterpart (undocumented drift); warns only when
 * a documented path has no route (stale doc).
 *
 * Pure comparison logic is exported as `compareRoutes` so it can be unit-tested
 * without touching the filesystem. The filesystem discovery runs only when this
 * module is executed directly (e.g. `npx tsx scripts/check-openapi-routes.ts`).
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

/**
 * Normalize a URL path so that only its static structure matters: every dynamic
 * segment — OpenAPI `{name}` or Next `[name]` / `[...name]` — collapses to a
 * single canonical `{}` token. Parameter names are intentionally ignored so a
 * documented `/api/reviews/{slug}` matches a route folder `[slug]`.
 */
export function normalizeRoutePath(path: string): string {
  return (
    "/" +
    path
      .split("/")
      .filter((seg) => seg.length > 0)
      .map((seg) => {
        // OpenAPI dynamic: {slug}, {versionId}, ...
        if (/^\{.*\}$/.test(seg)) return "{}";
        // Next dynamic ([slug]) and catch-all ([...path]) segments.
        if (/^\[.*\]$/.test(seg)) return "{}";
        return seg;
      })
      .join("/")
  );
}

/**
 * Endpoints intentionally excluded from the OpenAPI JSON contract. These are
 * infrastructure / browser-redirect endpoints, not documented JSON API surface:
 *
 *   - /api/auth/github/start, /api/auth/github/callback — OAuth flow endpoints
 *     that 302-redirect and set cookies; they are not JSON API and are covered
 *     by the auth flow, not the request/response contract.
 *
 * The list is applied to the discovered-routes side and printed on every run so
 * exclusions stay visible and can never silently mask real contract drift.
 */
export const CONTRACT_EXCLUDED_ROUTES: readonly string[] = [
  "/api/auth/github/start",
  "/api/auth/github/callback",
];

export interface RouteComparison {
  /** Actual routes with no matching documented path. This is the failure. */
  undocumented: string[];
  /** Documented paths with no matching actual route. Warning only. */
  missing: string[];
}

/**
 * Compare documented paths against actual routes by normalized structure.
 * Returns the original (un-normalized) strings for human-readable reporting.
 */
export function compareRoutes(documented: string[], actual: string[]): RouteComparison {
  const documentedNorm = new Set(documented.map(normalizeRoutePath));
  const actualNorm = new Set(actual.map(normalizeRoutePath));

  const undocumented = actual.filter((route) => !documentedNorm.has(normalizeRoutePath(route)));
  const missing = documented.filter((path) => !actualNorm.has(normalizeRoutePath(path)));

  return { undocumented, missing };
}

/**
 * Parse documented `/api/*` path keys out of an OpenAPI YAML document.
 * Looks for the `paths:` block, then collects two-space-indented keys of the
 * form `  /api/...:`, stopping when indentation returns to column 0 on a
 * meaningful (non-blank, non-comment) line.
 */
export function parseDocumentedPaths(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const paths: string[] = [];
  let inPaths = false;

  for (const line of lines) {
    if (!inPaths) {
      if (/^paths:\s*$/.test(line)) inPaths = true;
      continue;
    }

    // Blank or comment lines never terminate the block.
    if (line.trim() === "" || /^\s*#/.test(line)) continue;

    // A meaningful line at column 0 ends the paths block.
    if (/^\S/.test(line)) break;

    const match = line.match(/^ {2}(\/\S+):\s*$/);
    if (match && match[1].startsWith("/api/")) {
      paths.push(match[1]);
    }
  }

  return paths;
}

/**
 * Recursively find every `route.ts` under an App Router `api` directory and
 * derive its URL path. Route groups `(group)` are stripped; dynamic `[param]`
 * and catch-all `[...param]` folders are kept verbatim.
 */
export function discoverRoutes(apiDir: string, appDir: string): string[] {
  const routes: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === "route.ts") {
        const relDir = relative(appDir, dir);
        const segments = relDir
          .split(sep)
          .filter((seg) => seg.length > 0)
          // Drop route groups like (public) / (auth) — they do not affect the URL.
          .filter((seg) => !/^\(.*\)$/.test(seg));
        routes.push("/" + segments.join("/"));
      }
    }
  }

  walk(apiDir);
  return routes.sort();
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..");
  const openapiPath = join(repoRoot, "docs", "openapi.yaml");
  const appDir = join(repoRoot, "apps", "web", "src", "app");
  const apiDir = join(appDir, "api");

  const documented = parseDocumentedPaths(readFileSync(openapiPath, "utf-8")).sort();
  const allRoutes = discoverRoutes(apiDir, appDir);

  const excluded = new Set(CONTRACT_EXCLUDED_ROUTES.map(normalizeRoutePath));
  const actual = allRoutes.filter((route) => !excluded.has(normalizeRoutePath(route)));
  const skipped = allRoutes.filter((route) => excluded.has(normalizeRoutePath(route)));

  const { undocumented, missing } = compareRoutes(documented, actual);

  console.info("OpenAPI contract drift check");
  console.info(`  documented paths:  ${documented.length}`);
  console.info(`  route handlers:    ${allRoutes.length}`);
  console.info(`  in-contract routes: ${actual.length}`);

  if (skipped.length > 0) {
    console.info(`  excluded (infra/auth, not JSON contract): ${skipped.length}`);
    for (const route of skipped) console.info(`    - ${route}`);
  }

  if (missing.length > 0) {
    console.warn(`\n⚠ ${missing.length} documented path(s) with no route handler (stale doc):`);
    for (const path of missing) console.warn(`    ${path}`);
  }

  if (undocumented.length > 0) {
    console.error(`\n✗ ${undocumented.length} route(s) missing from docs/openapi.yaml:`);
    for (const route of undocumented) console.error(`    ${route}`);
    console.error("\nDocument these endpoints in docs/openapi.yaml or the contract has drifted.");
    process.exit(1);
  }

  console.info("\n✓ Every API route is documented in docs/openapi.yaml.");
}

// Run only when invoked directly, not when imported by the test suite.
const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
