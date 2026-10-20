/**
 * G1 route/principal/channel coverage manifest (ADR §3.1/§3.2, §11 T-PUB). It records what the
 * G1-empty harness actually captures and, visibly, everything it does not. `manifest.test.ts`
 * fails if a route handler exists that no entry accounts for, or if captured IDs drift from the
 * reviewed golden baseline. Nothing here is evidence of authorization or of the populated matrix.
 */

export const G1_COVERAGE_STATUS =
  "G1-empty partial: populated T-ROLE/T-PUB matrix deferred" as const;

export type Coverage = "captured-g1-empty" | "gap";

export type SurfaceEntry = {
  readonly id: string;
  readonly adr: "§3.1" | "§3.2";
  readonly channel: "http-route" | "http-metadata" | "http-page" | "non-http";
  /** Route directories under apps/web/src/app, matched exactly. */
  readonly exact?: readonly string[];
  /** Route directory prefixes under apps/web/src/app (the prefix itself and its descendants). */
  readonly prefixes?: readonly string[];
  readonly coverage: Coverage;
  /** Golden/capture IDs exercised for this surface. */
  readonly captureIds?: readonly string[];
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
    captureIds: ["health-ready"],
    note: "Real handler, real restricted Prisma connection (SELECT 1).",
  },
  {
    id: "health",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/health"],
    coverage: "captured-g1-empty",
    captureIds: ["health"],
    note: "Real handler; Date is fixed to the G1 clock. No database access.",
  },
  {
    id: "feeds-atom",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/feeds/atom"],
    coverage: "captured-g1-empty",
    captureIds: ["feeds-atom"],
    note: "Real handler and Prisma query over two published fixture versions plus one excluded draft.",
  },
  {
    id: "llms-txt",
    adr: "§3.1",
    channel: "http-route",
    exact: ["llms.txt"],
    coverage: "captured-g1-empty",
    captureIds: ["llms-txt"],
    note: "Real handler; deterministic base URL. No database access.",
  },
  {
    id: "openapi-yaml",
    adr: "§3.1",
    channel: "http-route",
    exact: ["openapi.yaml"],
    coverage: "captured-g1-empty",
    captureIds: ["openapi-yaml", "openapi-yaml-304"],
    note: "Real handler including the existing public ETag/304 behaviour (unchanged).",
  },
  {
    id: "openapi-json",
    adr: "§3.1",
    channel: "http-route",
    exact: ["openapi.json"],
    coverage: "captured-g1-empty",
    captureIds: ["openapi-json", "openapi-json-304"],
    note: "Real handler including the existing public ETag/304 behaviour (unchanged).",
  },
  {
    id: "feeds-lifecycle",
    adr: "§3.1",
    channel: "http-route",
    exact: ["api/feeds/lifecycle"],
    coverage: "gap",
    note: `${DEFERRED} Needs lifecycle ledger fixtures.`,
  },
  {
    id: "graph-search-discovery",
    adr: "§3.1",
    channel: "http-route",
    prefixes: [
      "api/graph",
      "api/landscape",
      "api/nodes",
      "api/claims",
      "api/search",
      "api/synthesis",
      "api/syntheses",
    ],
    coverage: "gap",
    note: `${DEFERRED} Includes node challenge exports and version snapshots.`,
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
    id: "profile",
    adr: "§3.1",
    channel: "http-route",
    prefixes: ["api/profile"],
    coverage: "gap",
    note: `${DEFERRED} Requires an authenticated session fixture.`,
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
    id: "notifications",
    adr: "§3.1",
    channel: "http-route",
    prefixes: ["api/notifications"],
    coverage: "gap",
    note: `${DEFERRED} Requires per-user session fixtures.`,
  },
  {
    id: "sitemap-robots",
    adr: "§3.1",
    channel: "http-metadata",
    coverage: "gap",
    note: "app/sitemap.ts and app/robots.ts metadata routes are not captured at G1.",
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
  readonly label: "anonymous" | "A-only" | "B-only" | "A+B" | "EDITOR" | "ADMIN";
  readonly executed: boolean;
  readonly note: string;
};

const NO_FIXTURE =
  "Blocking gap: no deterministic nonproduction session fixture is wired into the harness. At G1, A/B are labels only — no workspace memberships exist.";

export const PRINCIPALS: readonly PrincipalCase[] = [
  { label: "anonymous", executed: true, note: "All captured routes, no session cookie." },
  { label: "A-only", executed: false, note: NO_FIXTURE },
  { label: "B-only", executed: false, note: NO_FIXTURE },
  { label: "A+B", executed: false, note: NO_FIXTURE },
  { label: "EDITOR", executed: false, note: NO_FIXTURE },
  { label: "ADMIN", executed: false, note: NO_FIXTURE },
];

/** The single manifest entry that accounts for a route directory, or the list of all matches. */
export function surfacesForRoute(routeDirectory: string): SurfaceEntry[] {
  return SURFACES.filter(
    (entry) =>
      entry.exact?.includes(routeDirectory) === true ||
      entry.prefixes?.some(
        (prefix) => routeDirectory === prefix || routeDirectory.startsWith(`${prefix}/`),
      ) === true,
  );
}

export function capturedIds(): string[] {
  return SURFACES.flatMap((entry) => entry.captureIds ?? []);
}
