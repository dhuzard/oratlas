import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { PRINCIPAL_LABELS, type PrincipalLabel } from "./principals.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";

/**
 * G1 route/principal/channel coverage manifest (ADR §3.1/§3.2, §11 T-PUB). It records what the
 * G1-empty harness actually executes — derived from the reviewed scenario program, not hand-kept —
 * and, visibly, everything it does not. `manifest.test.ts` fails if a route handler exists that no
 * entry accounts for, if a scenario maps to no surface, or if the golden drifts from the program.
 * Nothing here is evidence of private authorization or of the populated matrix.
 */

export const G1_COVERAGE_STATUS =
  "G1-empty partial: populated T-ROLE/T-PUB matrix deferred" as const;

export type Coverage = "captured-g1-empty" | "metadata-loader-g1-empty" | "gap";

export type SurfaceEntry = {
  readonly id: string;
  readonly adr: "§3.1" | "§3.2";
  readonly channel: "http-route" | "http-metadata" | "http-page" | "non-http";
  /** Route directories under apps/web/src/app, matched exactly. */
  readonly exact?: readonly string[];
  /** Route directory prefixes under apps/web/src/app (the prefix itself and its descendants). */
  readonly prefixes?: readonly string[];
  readonly coverage: Coverage;
  /** Metadata loaders captured for this surface (not HTTP responses). */
  readonly loaders?: readonly string[];
  readonly note: string;
};

const DEFERRED =
  "Not captured at G1: needs deterministic fixtures, principals and mutation reset for this group.";

export const SURFACES: readonly SurfaceEntry[] = [
  {
    id: "health-ready",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/health/ready"],
    coverage: "captured-g1-empty",
    note: "Real handler, real restricted Prisma connection (SELECT 1).",
  },
  {
    id: "health",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/health"],
    coverage: "captured-g1-empty",
    note: "Real handler; Date is fixed to the G1 clock. No database access.",
  },
  {
    id: "feeds-atom",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/feeds/atom"],
    coverage: "captured-g1-empty",
    note: "Three published fixture versions in publish order; the non-public control is excluded.",
  },
  {
    id: "feeds-lifecycle",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/feeds/lifecycle"],
    coverage: "captured-g1-empty",
    note: "Non-empty ledger: exact actor/version/SHA/order; the control-review event is excluded.",
  },
  {
    id: "llms-txt",
    adr: "§3.1",
    channel: "http-route",
    exact: ["llms.txt"],
    coverage: "captured-g1-empty",
    note: "Real handler; deterministic base URL. No database access.",
  },
  {
    id: "openapi-yaml",
    adr: "§3.1",
    channel: "http-route",
    exact: ["openapi.yaml"],
    coverage: "captured-g1-empty",
    note: "Real handler including the existing public ETag/304 behaviour (unchanged).",
  },
  {
    id: "openapi-json",
    adr: "§3.1",
    channel: "http-route",
    exact: ["openapi.json"],
    coverage: "captured-g1-empty",
    note: "Real handler including the existing public ETag/304 behaviour (unchanged).",
  },
  {
    id: "search",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/search"],
    coverage: "captured-g1-empty",
    note: "contentType=review, sort=title, pageSize=1, pages 1 and 2 over two public reviews.",
  },
  {
    id: "claims",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/claims"],
    coverage: "captured-g1-empty",
    note: "Non-empty claim list from both public heads; the control claim is excluded.",
  },
  {
    id: "graph",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/graph"],
    coverage: "captured-g1-empty",
    note: "Source-assertion seed with two edges, limit=1, signed cursor continuation; RateLimit headers kept.",
  },
  {
    id: "notifications",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/notifications"],
    coverage: "captured-g1-empty",
    note: "Anonymous 401, each principal's own non-empty list, four invalid sessions 401, own mark-read 200, cross-user 404.",
  },
  {
    id: "profile-orcid",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/profile/orcid"],
    coverage: "captured-g1-empty",
    note: "Anonymous 401; each user clears only its own ORCID with one attributable audit row.",
  },
  {
    id: "editorial-ora-readiness",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/editorial/ora-certifications"],
    coverage: "captured-g1-empty",
    note: "GET only (no POST): 401/403/200 by role over a real publication version; providers disabled, available=false.",
  },
  {
    id: "editorial-certifier-status",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/editorial/certifiers/[id]/status"],
    coverage: "captured-g1-empty",
    note: "active→suspended: 401/403 by role, a cross-site precheck control, ADMIN 200 with row and audit change.",
  },
  {
    id: "graph-search-discovery",
    adr: "§3.1",
    channel: "http-route",
    prefixes: ["api/landscape", "api/nodes", "api/claims", "api/synthesis", "api/syntheses"],
    coverage: "gap",
    note: `${DEFERRED} Includes node challenge exports, claim passports and version snapshots.`,
  },
  {
    id: "reviews-publications-exports",
    adr: "§3.1",
    channel: "http-route",
    prefixes: [
      "api/reviews",
      "api/publications",
      "api/publication-versions",
      "api/publication-captures",
      "api/publication-claim-occurrences",
      "api/execution-passports",
    ],
    coverage: "gap",
    note: `${DEFERRED} Includes review exports, preserved files, packets, diffs and mutations.`,
  },
  {
    id: "protocol-snapshots",
    adr: "§3.1",
    channel: "http-route",
    prefixes: ["api/protocols"],
    coverage: "gap",
    note: DEFERRED,
  },
  {
    id: "auth",
    adr: "§3.1",
    channel: "http-route",
    prefixes: ["api/auth"],
    coverage: "gap",
    note: "OAuth start/callback are not exercised; no provider activation in G1.",
  },
  {
    id: "ingestion-discussion",
    adr: "§3.1",
    channel: "http-route",
    prefixes: ["api/submissions", "api/inspect", "api/validate-doi", "api/discuss"],
    coverage: "gap",
    note: `${DEFERRED} External GitHub/DOI/LLM providers must stay mocked.`,
  },
  {
    id: "scholarly-exchange",
    adr: "§3.1",
    channel: "http-route",
    prefixes: ["api/comments", "api/challenges", "api/challenge-responses"],
    coverage: "gap",
    note: DEFERRED,
  },
  {
    id: "editorial-verification-certification",
    adr: "§3.1",
    channel: "http-route",
    prefixes: [
      "api/editorial",
      "api/monitoring",
      "api/replications",
      "api/certifiers",
      "api/certification-protocols",
      "api/certification-results",
      "api/certification-runs",
      "api/verifiers",
      "api/verification-protocols",
      "api/verification-runs",
      "api/verification-artifacts",
    ],
    coverage: "gap",
    note: `${DEFERRED} EDITOR/ADMIN principals are required.`,
  },
  {
    id: "federation",
    adr: "§3.1",
    channel: "http-route",
    prefixes: ["api/federation"],
    coverage: "gap",
    note: DEFERRED,
  },
  {
    id: "sitemap-robots",
    adr: "§3.1",
    channel: "http-metadata",
    coverage: "metadata-loader-g1-empty",
    loaders: ["app/sitemap.ts", "app/robots.ts"],
    note: "Loader outputs only (deterministic Date/ISO serialization): static, review, version and node URLs plus excluded controls; robots exact. Next's /sitemap.xml and /robots.txt HTTP serialization is not captured.",
  },
  {
    id: "pages",
    adr: "§3.2",
    channel: "http-page",
    coverage: "gap",
    note: "Server-rendered pages, metadata, JSON-LD and OpenGraph are not captured at G1.",
  },
  {
    id: "non-http-channels",
    adr: "§3.2",
    channel: "non-http",
    coverage: "gap",
    note: "Jobs/CLIs, backups, search index, logs/metrics/audit, notifications/email, external lookups and timing are separately tracked; G1 does not prove them.",
  },
];

export type PrincipalCase = {
  readonly label: PrincipalLabel;
  readonly executed: boolean;
  readonly note: string;
};

const PRINCIPAL_NOTES: Readonly<Record<PrincipalLabel, string>> = {
  anonymous:
    "No session cookie; also the effective principal of the four invalid-session cases (malformed, signed-expired, tampered, signed-missing-user).",
  "A-only": "",
  "B-only": "",
  "A+B": "",
  EDITOR: "",
  ADMIN: "",
};

const LABEL_ONLY =
  "Production-signed fixture session for a synthetic public User row. At G1, A/B are labels only — no workspace or membership exists — so this is public-route evidence under a real session, not workspace authorization.";

/** Principal cases, `executed` derived from the scenario program. */
export const PRINCIPALS: readonly PrincipalCase[] = PRINCIPAL_LABELS.map((label) => ({
  label,
  executed: SCENARIOS.some((scenario) => scenario.kind === "http" && scenario.principal === label),
  note: PRINCIPAL_NOTES[label] || LABEL_ONLY,
}));

/**
 * The manifest entries that account for a route directory. An exact entry takes precedence over
 * group prefixes; anything other than exactly one match is a manifest error.
 */
export function surfacesForRoute(routeDirectory: string): SurfaceEntry[] {
  const exact = SURFACES.filter((entry) => entry.exact?.includes(routeDirectory) === true);
  if (exact.length > 0) return exact;
  return SURFACES.filter(
    (entry) =>
      entry.prefixes?.some(
        (prefix) => routeDirectory === prefix || routeDirectory.startsWith(`${prefix}/`),
      ) === true,
  );
}

/** Scenario ids executed for a surface (HTTP routes by route directory, metadata by loader). */
export function scenarioIdsFor(
  surface: SurfaceEntry,
  program: readonly Scenario[] = SCENARIOS,
): string[] {
  return program
    .filter((scenario) =>
      scenario.kind === "http"
        ? surfacesForRoute(scenario.route).includes(surface)
        : scenario.kind === "metadata-loader" && (surface.loaders ?? []).includes(scenario.loader),
    )
    .map((scenario) => scenario.id);
}

/** Route directories (containing route.ts) under the app directory, excluding api/private. */
export function routeDirectories(appDirectory: string): string[] {
  const found: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name === "route.ts") {
        found.push(relative(appDirectory, directory).replaceAll("\\", "/"));
      }
    }
  };
  walk(appDirectory);
  return found.filter((route) => !route.startsWith("api/private")).sort();
}

/** Coverage actually executed by the program, against the current route tree. */
export function coverageSummary(appDirectory: string, program: readonly Scenario[] = SCENARIOS) {
  const routes = routeDirectories(appDirectory);
  const http = program.filter((scenario) => scenario.kind === "http");
  const exercised = [...new Set(http.map((scenario) => scenario.route))].sort();
  const statuses: Record<string, number> = {};
  for (const scenario of http) {
    const key = String(scenario.expect.status);
    statuses[key] = (statuses[key] ?? 0) + 1;
  }
  return {
    status: G1_COVERAGE_STATUS,
    routeFiles: routes.length,
    routeFilesExercised: exercised.length,
    routeFilesNotExercised: routes.filter((route) => !exercised.includes(route)).length,
    exercisedRoutes: exercised,
    httpScenarios: http.length,
    expectedStatuses: statuses,
    metadataLoaderRecords: program.filter((scenario) => scenario.kind === "metadata-loader").length,
    stateRecords: program.filter((scenario) => scenario.kind === "db-state").length,
    principalsExecuted: PRINCIPALS.filter((principal) => principal.executed).map((p) => p.label),
    invalidSessionCases: [
      ...new Set(
        http
          .filter(
            (scenario) => scenario.session.case !== "none" && scenario.session.case !== "valid",
          )
          .map((scenario) => scenario.session.case),
      ),
    ],
    gapSurfaces: SURFACES.filter((surface) => surface.coverage === "gap").map((s) => s.id),
    notCovered: [
      "remaining route files (see routeFilesNotExercised and gap surfaces)",
      "Next HTTP serving: routing, middleware, RSC/HTML pages, metadata route serialization",
      "non-HTTP channels and timing",
      "populated private T-ROLE/T-PUB matrices",
      "deployment/CDN caching",
    ],
  };
}

export function capturedIds(program: readonly Scenario[] = SCENARIOS): string[] {
  return SURFACES.flatMap((entry) => scenarioIdsFor(entry, program));
}
