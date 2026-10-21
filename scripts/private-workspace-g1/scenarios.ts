import { OAUTH_DISABLED_SCENARIOS } from "./oauth-disabled-scenarios.js";
import { G1_BASE_URL, G1_FIXED_CLOCK, type HttpMethod } from "./capture.js";
import type { WorkerAuthority } from "./worker-authority.js";
import { workerAuthorityProblems } from "./worker-authority.js";
import { capabilityHeaderProblems, workerOutputProblems } from "./worker-capture-safety.js";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { publicPrincipalScenarios } from "./principal-matrix.js";
import { editorialScenarios } from "./editorial-scenarios.js";
import { SCHOLARLY_SCENARIOS } from "./scholarly-scenarios.js";
import { publicDiscoveryScenarios } from "./discovery-scenarios.js";
import { publicProtocolScenarios } from "./protocol-scenarios.js";
import { EDITORIAL_READ_SCENARIOS } from "./editorial-read-scenarios.js";
import {
  fixtureUser,
  sha256Text,
  FIXTURE_USERS,
  NEGATIVE_SESSIONS,
  NO_SESSION,
  validSession,
  type PrincipalLabel,
  type SessionRecipe,
  type UserPrincipalLabel,
} from "./principals.js";

/**
 * The reviewed, ordered G1 scenario program. Each capture child (baseline, baseline repeat, after,
 * after repeat — each after a fresh fixture reset) runs exactly this list, in this order, against
 * real production handlers. Expected outcomes live here, not in the golden file: a golden can never
 * authorize an error status, an empty collection or a swapped principal on its own.
 *
 * This is still partial G1 coverage: a bounded subset of production route handlers and two metadata
 * loaders. The manifest derives exact exercised and gap counts from the current route tree. Everything else stays a visible gap in manifest.ts.
 */

export type JsonCheck =
  | { readonly pointer: string; readonly equals: unknown }
  | { readonly pointer: string; readonly length: number }
  | { readonly pointer: string; readonly minLength: number }
  | { readonly pointer: string; readonly present: true }
  | { readonly pointer: string; readonly absent: true };

export type HttpExpectation = {
  /** Exact status. */
  readonly status: number;
  /** Reviewed denial; required exactly when status >= 400 (code/message must match the body). */
  readonly denial?: {
    readonly code: string;
    readonly message: string;
    /** Explicit native top-level envelope; omission keeps the existing nested error envelope. */
    readonly envelope?: "root";
  };
  readonly json?: readonly JsonCheck[];
  /** Substrings that must not occur in the body (controls and other principals' data). */
  readonly bodyExcludes?: readonly string[];
  /** Required public text-export markers, independent of regenerated golden bytes. */
  readonly bodyIncludes?: readonly string[];
  /** Exact public download bytes and security headers, independently of the golden. */
  readonly bodyEquals?: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** Headers whose absence is an independent contract, not merely a golden observation. */
  readonly absentHeaders?: readonly string[];
  /** Equal status/body/headers/cookies across principals; request identity stays distinct. */
  readonly sameResponseAs?: string;
};

/** A request input taken from an earlier record of the same capture (cursor, ETag). */
export type DerivedInput = {
  readonly from: string;
  readonly source: { readonly header: string } | { readonly jsonPointer: string };
  readonly into: { readonly header: string } | { readonly query: string };
};

export type HttpScenario = {
  readonly kind: "http";
  readonly id: string;
  /** Route directory under apps/web/src/app (manifest key and Next page name). */
  readonly route: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly workerAuthority?: WorkerAuthority;
  readonly body?: unknown;
  readonly params?: Readonly<Record<string, string | string[]>>;
  readonly principal: PrincipalLabel;
  readonly session: SessionRecipe;
  readonly derive?: DerivedInput;
  /** Deliberate repeat of an earlier identical request (e.g. after a mutation). */
  readonly repeatOf?: string;
  readonly expect: HttpExpectation;
};

export type MetadataScenario = {
  readonly kind: "metadata-loader";
  readonly id: string;
  readonly loader: "app/sitemap.ts" | "app/robots.ts";
  readonly expect: {
    readonly includes?: readonly string[];
    readonly excludes?: readonly string[];
    readonly equals?: unknown;
  };
};

export type StateScenario = {
  readonly kind: "db-state";
  readonly id: string;
  /** Exact expected projection (see `StateProjection`). */
  readonly expect: StateProjection;
};

export type Scenario = HttpScenario | MetadataScenario | StateScenario;

/**
 * Deterministic projection of the mutable fixture state. Audit rows are reduced to actor, action,
 * subject and details; their UUIDs, default timestamps and platform version are deliberately not
 * captured, and `User.updatedAt` (stamped by Prisma's engine clock) is excluded likewise.
 */
export type StateProjection = {
  readonly users: ReadonlyArray<{
    readonly id: string;
    readonly role: string;
    readonly orcid: string | null;
    readonly orcidVerifiedAt: string | null;
  }>;
  readonly notifications: ReadonlyArray<{
    readonly id: string;
    readonly userId: string;
    readonly readAt: string | null;
  }>;
  readonly certifiers: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly activatedAt: string | null;
    readonly retiredAt: string | null;
  }>;
  readonly audit: {
    readonly count: number;
    readonly events: ReadonlyArray<{
      readonly actorId: string | null;
      readonly action: string;
      readonly subjectType: string;
      readonly subjectId: string;
      readonly details: unknown;
    }>;
  };
  readonly excluded: readonly string[];
};

export const STATE_EXCLUDED_FIELDS = [
  "AuditEvent.id",
  "AuditEvent.createdAt",
  "AuditEvent.platformVersion",
  "User.updatedAt",
] as const;

const SAME_ORIGIN_JSON = {
  "content-type": "application/json",
  origin: G1_BASE_URL,
  "sec-fetch-site": "same-origin",
} as const;

const USER_LABELS: readonly UserPrincipalLabel[] = FIXTURE_USERS.map((user) => user.label);

const NOTIFICATIONS: Readonly<Record<UserPrincipalLabel, readonly string[]>> = {
  "A-only": ["g1-notification-a-only-2", "g1-notification-a-only-1"],
  "B-only": ["g1-notification-b-only-1"],
  "A+B": ["g1-notification-a-and-b-1"],
  EDITOR: ["g1-notification-editor-1"],
  ADMIN: ["g1-notification-admin-1"],
};
const ALL_NOTIFICATION_IDS = Object.values(NOTIFICATIONS).flat();

const unauthorized = { code: "unauthorized", message: "Sign in required." } as const;

function slug(label: PrincipalLabel): string {
  return label.toLowerCase().replace("+", "-and-");
}

const SEED_USERS: StateProjection["users"] = [
  { id: "g1-user-a-and-b", role: "USER", orcid: "0000-0000-0000-0003", orcidVerifiedAt: null },
  {
    id: "g1-user-a-only",
    role: "USER",
    orcid: "0000-0000-0000-0001",
    orcidVerifiedAt: "2026-01-10T00:00:00.000Z",
  },
  { id: "g1-user-admin", role: "ADMIN", orcid: "0000-0000-0000-0005", orcidVerifiedAt: null },
  { id: "g1-user-b-only", role: "USER", orcid: "0000-0000-0000-0002", orcidVerifiedAt: null },
  { id: "g1-user-editor", role: "EDITOR", orcid: "0000-0000-0000-0004", orcidVerifiedAt: null },
];

function notificationsState(readIds: readonly string[]): StateProjection["notifications"] {
  return FIXTURE_USERS.flatMap((user) =>
    NOTIFICATIONS[user.label].map((id) => ({
      id,
      userId: user.id,
      readAt: readIds.includes(id) ? G1_FIXED_CLOCK : null,
    })),
  ).sort((left, right) => (left.id < right.id ? -1 : 1));
}

const SEED_CERTIFIERS: StateProjection["certifiers"] = [
  {
    id: "g1-certifier-1",
    status: "active",
    activatedAt: "2026-01-05T00:00:00.000Z",
    retiredAt: null,
  },
  {
    id: "g1-certifier-ora",
    status: "active",
    activatedAt: "2026-01-05T00:00:00.000Z",
    retiredAt: null,
  },
];

function orcidCleared(labels: readonly UserPrincipalLabel[]): StateProjection["users"] {
  const cleared = new Set(labels.map((label) => fixtureUser(label).id));
  return SEED_USERS.map((user) =>
    cleared.has(user.id) ? { ...user, orcid: null, orcidVerifiedAt: null } : user,
  );
}

function orcidAudit(labels: readonly UserPrincipalLabel[]) {
  return labels
    .map((label) => fixtureUser(label).id)
    .sort()
    .map((id) => ({
      actorId: id,
      action: "profile.orcid-set",
      subjectType: "user",
      subjectId: id,
      details: { orcid: null, verified: false },
    }));
}

const certifierAudit = {
  actorId: "g1-user-admin",
  action: "certification.certifier-status",
  subjectType: "certifier",
  subjectId: "g1-certifier-1",
  details: { previous: "active", status: "suspended" },
};

function http(
  scenario: Omit<HttpScenario, "kind" | "session"> & { session?: SessionRecipe },
): HttpScenario {
  return {
    kind: "http",
    ...scenario,
    session:
      scenario.session ??
      (scenario.principal === "anonymous" ? NO_SESSION : validSession(scenario.principal)),
  };
}

function legacyPublicScenarios(): HttpScenario[] {
  const anonymous = (id: string, route: string, path: string, extra: Partial<HttpScenario> = {}) =>
    http({
      id,
      route,
      method: "GET",
      path,
      principal: "anonymous",
      expect: { status: 200 },
      ...extra,
    });
  const etag = (from: string): DerivedInput => ({
    from,
    source: { header: "etag" },
    into: { header: "if-none-match" },
  });
  return [
    anonymous("health-ready", "api/health/ready", "/api/health/ready"),
    anonymous("health", "api/health", "/api/health", {
      expect: { status: 200, json: [{ pointer: "/time", equals: G1_FIXED_CLOCK }] },
    }),
    anonymous("feeds-atom", "api/feeds/atom", "/api/feeds/atom", {
      expect: { status: 200, bodyExcludes: ["g1-version-3", "unpublished draft", "g1-control"] },
    }),
    anonymous("llms-txt", "llms.txt", "/llms.txt"),
    anonymous("openapi-yaml", "openapi.yaml", "/openapi.yaml"),
    anonymous("openapi-yaml-304", "openapi.yaml", "/openapi.yaml", {
      derive: etag("openapi-yaml"),
      expect: { status: 304 },
    }),
    anonymous("openapi-json", "openapi.json", "/openapi.json"),
    anonymous("openapi-json-304", "openapi.json", "/openapi.json", {
      derive: etag("openapi-json"),
      expect: { status: 304 },
    }),
  ];
}

function discoveryScenarios(): HttpScenario[] {
  const search = "/api/search?contentType=review&sort=title&pageSize=1";
  const graph = "/api/graph?seed=g1-node-1&status=source-assertion&direction=outgoing&limit=1";
  const hidden = ["g1-control", "g1-version-3", "Control claim", "g1-node-control"];
  return [
    http({
      id: "search-reviews-title-page-1",
      route: "api/search",
      method: "GET",
      path: `${search}&page=1`,
      principal: "anonymous",
      expect: {
        status: 200,
        json: [
          { pointer: "/total", equals: 2 },
          { pointer: "/page", equals: 1 },
          { pointer: "/items", length: 1 },
          { pointer: "/items/0/contentType", equals: "review" },
          { pointer: "/items/0/slug", equals: "g1-fixture-review" },
        ],
        bodyExcludes: hidden,
      },
    }),
    http({
      id: "search-reviews-title-page-2",
      route: "api/search",
      method: "GET",
      path: `${search}&page=2`,
      principal: "anonymous",
      expect: {
        status: 200,
        json: [
          { pointer: "/total", equals: 2 },
          { pointer: "/page", equals: 2 },
          { pointer: "/items", length: 1 },
          { pointer: "/items/0/slug", equals: "g1-second-review" },
        ],
        bodyExcludes: hidden,
      },
    }),
    http({
      id: "claims",
      route: "api/claims",
      method: "GET",
      path: "/api/claims",
      principal: "anonymous",
      expect: {
        status: 200,
        json: [
          { pointer: "/total", equals: 2 },
          { pointer: "/items", length: 2 },
        ],
        bodyExcludes: hidden,
      },
    }),
    http({
      id: "graph-source-assertions-page-1",
      route: "api/graph",
      method: "GET",
      path: graph,
      principal: "anonymous",
      expect: {
        status: 200,
        json: [
          { pointer: "/seed/nodeVersionId", equals: "g1-node-1-v1" },
          { pointer: "/edges", length: 1 },
          { pointer: "/edges/0/id", equals: "g1-edge-1" },
          { pointer: "/edges/0/status", equals: "source-assertion" },
          { pointer: "/page/nextCursor", present: true },
        ],
        bodyExcludes: ["g1-edge-3-unconfirmed", "g1-node-control"],
      },
    }),
    http({
      id: "graph-source-assertions-page-2",
      route: "api/graph",
      method: "GET",
      path: graph,
      principal: "anonymous",
      derive: {
        from: "graph-source-assertions-page-1",
        source: { jsonPointer: "/page/nextCursor" },
        into: { query: "cursor" },
      },
      expect: {
        status: 200,
        json: [
          { pointer: "/edges", length: 1 },
          { pointer: "/edges/0/id", equals: "g1-edge-2" },
          { pointer: "/page/nextCursor", absent: true },
        ],
        bodyExcludes: ["g1-edge-3-unconfirmed", "g1-node-control"],
      },
    }),
    http({
      id: "feeds-lifecycle",
      route: "api/feeds/lifecycle",
      method: "GET",
      path: "/api/feeds/lifecycle",
      principal: "anonymous",
      expect: {
        status: 200,
        json: [
          { pointer: "/generatedAt", equals: G1_FIXED_CLOCK },
          { pointer: "/events", length: 2 },
          { pointer: "/events/0/id", equals: "g1-lifecycle-2" },
          { pointer: "/events/0/actorLogin", equals: "g1-fixture-admin" },
          { pointer: "/events/0/reviewVersionId", equals: "g1-version-4" },
          { pointer: "/events/0/commitSha", equals: "4".repeat(40) },
          { pointer: "/events/1/id", equals: "g1-lifecycle-1" },
          { pointer: "/events/1/actorLogin", equals: "g1-fixture-editor" },
          { pointer: "/events/1/reviewVersionId", equals: "g1-version-2" },
          { pointer: "/events/1/supersedesVersionId", equals: "g1-version-1" },
          { pointer: "/events/1/commitSha", equals: "2".repeat(40) },
        ],
        bodyExcludes: ["g1-lifecycle-control", "g1-version-3"],
      },
    }),
  ];
}

function notificationList(label: PrincipalLabel, id = `notifications-${slug(label)}`) {
  if (label === "anonymous") {
    return http({
      id,
      route: "api/notifications",
      method: "GET",
      path: "/api/notifications",
      principal: "anonymous",
      expect: { status: 401, denial: unauthorized },
    });
  }
  const own = NOTIFICATIONS[label];
  return http({
    id,
    route: "api/notifications",
    method: "GET",
    path: "/api/notifications",
    principal: label,
    expect: {
      status: 200,
      json: [
        { pointer: "/notifications", length: own.length },
        ...own.map((value, index) => ({ pointer: `/notifications/${index}/id`, equals: value })),
      ],
      bodyExcludes: ALL_NOTIFICATION_IDS.filter((value) => !own.includes(value)),
    },
  });
}

function authScenarios(): Scenario[] {
  const scenarios: Scenario[] = [];
  scenarios.push(notificationList("anonymous"));
  for (const label of USER_LABELS) scenarios.push(notificationList(label));
  for (const session of NEGATIVE_SESSIONS) {
    scenarios.push(
      http({
        id: `notifications-session-${session.case}`,
        route: "api/notifications",
        method: "GET",
        path: "/api/notifications",
        principal: "anonymous",
        session,
        expect: { status: 401, denial: unauthorized },
      }),
    );
  }
  scenarios.push(
    http({
      id: "notification-mark-own-a-only",
      route: "api/notifications",
      method: "POST",
      path: "/api/notifications",
      headers: SAME_ORIGIN_JSON,
      body: { notificationId: "g1-notification-a-only-1" },
      principal: "A-only",
      expect: { status: 200, json: [{ pointer: "/status", equals: "read" }] },
    }),
    http({
      id: "notification-mark-cross-user-b-only",
      route: "api/notifications",
      method: "POST",
      path: "/api/notifications",
      headers: SAME_ORIGIN_JSON,
      body: { notificationId: "g1-notification-a-only-2" },
      principal: "B-only",
      expect: {
        status: 404,
        denial: { code: "not-found", message: "Notification not found or already read." },
      },
    }),
    {
      ...notificationList("A-only", "notifications-a-only-after-mark"),
      repeatOf: "notifications-a-only",
      expect: {
        status: 200,
        json: [
          { pointer: "/notifications", length: 2 },
          { pointer: "/notifications/0/id", equals: "g1-notification-a-only-2" },
          { pointer: "/notifications/0/readAt", absent: true },
          { pointer: "/notifications/1/id", equals: "g1-notification-a-only-1" },
          { pointer: "/notifications/1/readAt", equals: G1_FIXED_CLOCK },
        ],
      },
    },
    {
      kind: "db-state",
      id: "state-after-notification-mark",
      expect: {
        users: SEED_USERS,
        notifications: notificationsState(["g1-notification-a-only-1"]),
        certifiers: SEED_CERTIFIERS,
        audit: { count: 0, events: [] },
        excluded: STATE_EXCLUDED_FIELDS,
      },
    },
  );

  const orcid = (label: PrincipalLabel) =>
    http({
      id: `profile-orcid-clear-${slug(label)}`,
      route: "api/profile/orcid",
      method: "POST",
      path: "/api/profile/orcid",
      headers: SAME_ORIGIN_JSON,
      body: { orcid: null },
      principal: label,
      expect:
        label === "anonymous"
          ? { status: 401, denial: unauthorized }
          : {
              status: 200,
              json: [
                { pointer: "/orcid", equals: null },
                { pointer: "/verified", equals: false },
              ],
            },
    });
  scenarios.push(orcid("anonymous"), orcid("A-only"), {
    kind: "db-state",
    id: "state-after-orcid-a-only",
    expect: {
      users: orcidCleared(["A-only"]),
      notifications: notificationsState(["g1-notification-a-only-1"]),
      certifiers: SEED_CERTIFIERS,
      audit: { count: 1, events: orcidAudit(["A-only"]) },
      excluded: STATE_EXCLUDED_FIELDS,
    },
  });
  for (const label of USER_LABELS.filter((candidate) => candidate !== "A-only")) {
    scenarios.push(orcid(label));
  }

  for (const label of ["anonymous", ...USER_LABELS] as const) {
    const editorial = label === "EDITOR" || label === "ADMIN";
    scenarios.push(
      http({
        id: `ora-readiness-${slug(label)}`,
        route: "api/editorial/ora-certifications",
        method: "GET",
        path: "/api/editorial/ora-certifications?publicationVersionId=g1-publication-version-1",
        principal: label,
        expect:
          label === "anonymous"
            ? { status: 401, denial: unauthorized }
            : editorial
              ? {
                  status: 200,
                  json: [
                    { pointer: "/available", equals: false },
                    { pointer: "/publicationVersion/id", equals: "g1-publication-version-1" },
                    { pointer: "/protocol/id", equals: "g1-protocol-ora" },
                  ],
                }
              : {
                  status: 403,
                  denial: { code: "forbidden", message: "Editor role required." },
                },
      }),
    );
  }

  const certifierStatus = (
    label: PrincipalLabel,
    expectation: HttpExpectation,
    id = `certifier-suspend-${slug(label)}`,
    headers: Readonly<Record<string, string>> = SAME_ORIGIN_JSON,
  ) =>
    http({
      id,
      route: "api/editorial/certifiers/[id]/status",
      method: "POST",
      path: "/api/editorial/certifiers/g1-certifier-1/status",
      params: { id: "g1-certifier-1" },
      headers,
      body: { status: "suspended" },
      principal: label,
      expect: expectation,
    });
  scenarios.push(certifierStatus("anonymous", { status: 401, denial: unauthorized }));
  for (const label of ["A-only", "B-only", "A+B", "EDITOR"] as const) {
    scenarios.push(
      certifierStatus(label, {
        status: 403,
        denial: { code: "forbidden", message: "Administrator role required." },
      }),
    );
  }
  // Control: the same-origin precheck refuses a cross-site request before any session check, so
  // every role outcome above is an authorization outcome, not a CSRF 403.
  scenarios.push(
    certifierStatus(
      "ADMIN",
      {
        status: 403,
        denial: { code: "forbidden", message: "Cross-site mutation requests are refused." },
      },
      "certifier-suspend-admin-cross-site-control",
      { ...SAME_ORIGIN_JSON, "sec-fetch-site": "cross-site" },
    ),
    certifierStatus("ADMIN", {
      status: 200,
      json: [
        { pointer: "/id", equals: "g1-certifier-1" },
        { pointer: "/status", equals: "suspended" },
        { pointer: "/activatedAt", equals: "2026-01-05T00:00:00.000Z" },
        { pointer: "/retiredAt", equals: null },
      ],
    }),
    {
      kind: "db-state",
      id: "state-final",
      expect: {
        users: orcidCleared(USER_LABELS),
        notifications: notificationsState(["g1-notification-a-only-1"]),
        certifiers: [{ ...SEED_CERTIFIERS[0]!, status: "suspended" }, SEED_CERTIFIERS[1]!],
        audit: {
          count: 6,
          events: [certifierAudit, ...orcidAudit(USER_LABELS)].sort((left, right) =>
            `${left.action}|${left.actorId}` < `${right.action}|${right.actorId}` ? -1 : 1,
          ),
        },
        excluded: STATE_EXCLUDED_FIELDS,
      },
    },
  );
  return scenarios;
}

function metadataScenarios(): MetadataScenario[] {
  const url = (path: string) => `${G1_BASE_URL}${path}`;
  return [
    {
      kind: "metadata-loader",
      id: "metadata-sitemap",
      loader: "app/sitemap.ts",
      expect: {
        includes: [
          url("/"),
          url("/archive"),
          url("/reviews/g1-fixture-review"),
          url("/reviews/g1-fixture-review/versions/g1-version-1"),
          url("/reviews/g1-fixture-review/versions/g1-version-2"),
          url("/reviews/g1-second-review"),
          url("/reviews/g1-second-review/versions/g1-version-4"),
          url("/nodes/g1-node-1"),
          url("/nodes/g1-node-1/versions/g1-node-1-v1"),
          url("/nodes/g1-node-2"),
          url("/nodes/g1-node-3"),
        ],
        excludes: ["g1-control-review", "g1-version-3", "g1-node-control", "/api/"],
      },
    },
    {
      kind: "metadata-loader",
      id: "metadata-robots",
      loader: "app/robots.ts",
      expect: {
        equals: {
          rules: {
            userAgent: "*",
            allow: "/",
            disallow: [
              "/signin",
              "/editorial",
              "/notifications",
              "/submit",
              "/submissions",
              "/api/auth/",
              "/api/editorial/",
              "/api/admin/",
              "/api/submissions",
            ],
          },
          sitemap: url("/sitemap.xml"),
          host: G1_BASE_URL,
        },
      },
    },
  ];
}

/** The ordered program; ids are unique and the order is part of the contract. */

/** Synthetic PUBLIC content only; this does not stand in for private authorization. */
export const CAPTURE_BYTES_SENTINEL = "G1 retained capture bytes: <script>inert</script>";
export const PRESERVED_DOWNLOAD = "<script>G1 inert public attachment</script>\n";

function artifactScenarios(): HttpScenario[] {
  const labels: readonly PrincipalLabel[] = ["anonymous", ...USER_LABELS];
  const scenarios: HttpScenario[] = [];
  const metadata = "api/publication-captures/[id]";
  const packet = "api/publication-versions/[id]/packet";
  const files = "api/reviews/[slug]/versions/[versionId]/files/[...path]";
  for (const label of labels) {
    const principalSlug = slug(label);
    const session = label === "anonymous" ? NO_SESSION : validSession(label);
    for (const kind of ["capture", "packet"] as const) {
      const missing = kind === "capture" ? "g1-missing-capture" : "g1-missing-publication-version";
      const id = kind === "capture" ? "g1-capture-source" : "g1-publication-version-1";
      const route = kind === "capture" ? metadata : packet;
      const path = (value: string) =>
        kind === "capture"
          ? `/api/publication-captures/${value}`
          : `/api/publication-versions/${value}/packet`;
      scenarios.push(
        {
          kind: "http",
          id: `${kind}-${principalSlug}`,
          route,
          method: "GET",
          path: path(id),
          params: { id },
          principal: label,
          session,
          expect: {
            status: 200,
            headers: { "content-type": "application/json" },
            bodyExcludes: [
              CAPTURE_BYTES_SENTINEL,
              Buffer.from(CAPTURE_BYTES_SENTINEL).toString("base64"),
              '"contentBytes"',
            ],
            ...(label === "anonymous" ? {} : { sameResponseAs: `${kind}-anonymous` }),
            json:
              kind === "capture"
                ? [
                    { pointer: "/id", equals: "g1-capture-source" },
                    { pointer: "/publicationVersionId", equals: "g1-publication-version-1" },
                    { pointer: "/declaredPath", equals: "article.md" },
                    { pointer: "/byteLength", equals: Buffer.byteLength(CAPTURE_BYTES_SENTINEL) },
                    { pointer: "/contentSha256", equals: sha256Text(CAPTURE_BYTES_SENTINEL) },
                    { pointer: "/contentBytes", absent: true },
                  ]
                : [
                    { pointer: "/schemaVersion", equals: "1.3.0" },
                    { pointer: "/version/id", equals: "g1-publication-version-1" },
                    { pointer: "/captures", length: 2 },
                    { pointer: "/captures/0/id", equals: "g1-capture-manifest" },
                    { pointer: "/captures/1/id", equals: "g1-capture-source" },
                    {
                      pointer: "/captures/1/contentSha256",
                      equals: sha256Text(CAPTURE_BYTES_SENTINEL),
                    },
                    { pointer: "/captures/1/contentBytes", absent: true },
                    { pointer: "/content", length: 0 },
                    { pointer: "/occurrences", length: 0 },
                  ],
          },
        },
        {
          kind: "http",
          id: `${kind}-missing-${principalSlug}`,
          route,
          method: "GET",
          path: path(missing),
          params: { id: missing },
          principal: label,
          session,
          expect: {
            status: 404,
            denial: {
              code: "not-found",
              message:
                kind === "capture"
                  ? "Publication capture not found."
                  : "Publication version not found.",
            },
            ...(label === "anonymous" ? {} : { sameResponseAs: `${kind}-missing-anonymous` }),
          },
        },
      );
    }
    for (const state of ["public", "missing", "tombstoned"] as const) {
      const versionId =
        state === "public"
          ? "g1-version-2"
          : state === "missing"
            ? "g1-version-missing"
            : "g1-version-tombstoned";
      scenarios.push({
        kind: "http",
        id: `file-${state}-${principalSlug}`,
        route: files,
        method: "GET",
        path: `/api/reviews/g1-fixture-review/versions/${versionId}/files/article.md`,
        params: { slug: "g1-fixture-review", versionId, path: ["article.md"] },
        principal: label,
        session,
        expect:
          state === "public"
            ? {
                status: 200,
                bodyEquals: PRESERVED_DOWNLOAD,
                headers: {
                  "content-type": "text/plain; charset=utf-8",
                  "content-disposition": 'attachment; filename="article.md.txt"',
                  "x-content-type-options": "nosniff",
                  "cache-control": "no-store, must-revalidate",
                  pragma: "no-cache",
                },
                ...(label === "anonymous" ? {} : { sameResponseAs: "file-public-anonymous" }),
              }
            : {
                status: 404,
                denial: {
                  code: "not-found",
                  message:
                    "No preserved content for this path. Only textual files captured at inspection are preserved.",
                },
                sameResponseAs:
                  state === "tombstoned"
                    ? `file-missing-${principalSlug}`
                    : label === "anonymous"
                      ? undefined
                      : "file-missing-anonymous",
                bodyExcludes: [PRESERVED_DOWNLOAD, "G1 tombstoned attachment control"],
              },
      });
    }
  }
  return scenarios;
}

const PUBLIC_BASE_SCENARIOS: readonly Scenario[] = [
  ...legacyPublicScenarios(),
  ...discoveryScenarios(),
];

const AUTH_SCENARIOS = authScenarios();
const AUTH_FINAL_STATE = AUTH_SCENARIOS.find(
  (scenario): scenario is StateScenario =>
    scenario.kind === "db-state" && scenario.id === "state-final",
);
if (!AUTH_FINAL_STATE) throw new Error("G1 auth final state is required");

export const SCENARIOS: readonly Scenario[] = [
  ...PUBLIC_BASE_SCENARIOS,
  ...publicPrincipalScenarios(PUBLIC_BASE_SCENARIOS),
  ...AUTH_SCENARIOS,
  ...artifactScenarios(),
  ...metadataScenarios(),
  ...publicDiscoveryScenarios(),
  ...SCHOLARLY_SCENARIOS,
  ...publicProtocolScenarios(),
  ...EDITORIAL_READ_SCENARIOS,
  ...OAUTH_DISABLED_SCENARIOS,
  ...editorialScenarios(AUTH_FINAL_STATE.expect),
];

export function httpScenarios(program: readonly Scenario[] = SCENARIOS): HttpScenario[] {
  return program.filter((scenario): scenario is HttpScenario => scenario.kind === "http");
}

/** The JSON request body exactly as dispatched. */
export function requestBodyText(scenario: HttpScenario): string | null {
  return scenario.body === undefined ? null : JSON.stringify(scenario.body);
}

/** Problems with a program definition (unique ids/composite keys, coherent expectations). */
export function programProblems(program: readonly Scenario[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const composite = new Set<string>();
  program.forEach((scenario, index) => {
    if (workerOutputProblems(JSON.stringify(scenario)).length) {
      problems.push("Raw worker capability in program definition");
      return;
    }
    if (scenario.kind === "http" && capabilityHeaderProblems(scenario.headers ?? {}).length) {
      problems.push("Raw request capability header in program definition");
      return;
    }
    if (
      scenario.kind === "http" &&
      scenario.workerAuthority !== undefined &&
      workerAuthorityProblems(scenario.workerAuthority).length
    ) {
      problems.push("Invalid worker authority in program definition");
      return;
    }
    if (ids.has(scenario.id)) problems.push(`duplicate scenario id ${scenario.id}`);
    ids.add(scenario.id);
    const key =
      scenario.kind === "http"
        ? `${scenario.kind}|${scenario.method}|${scenario.path}|${scenario.principal}|${scenario.session.case}|${requestBodyText(scenario) ?? ""}|${JSON.stringify(scenario.headers ?? {})}|${scenario.derive?.from ?? ""}|${scenario.repeatOf ?? ""}${scenario.workerAuthority === undefined ? "" : `|${canonicalJson(scenario.workerAuthority)}`}`
        : `${scenario.kind}|${scenario.id}`;
    if (composite.has(key)) problems.push(`duplicate composite key ${key}`);
    composite.add(key);
    if (scenario.kind !== "http") return;
    const { status, denial } = scenario.expect;
    if (status >= 400 && !denial) problems.push(`${scenario.id}: error status without denial`);
    if (status < 400 && denial) problems.push(`${scenario.id}: denial on a non-error status`);
    const earlier = (id: string) => program.slice(0, index).some((prior) => prior.id === id);
    if (scenario.derive && !earlier(scenario.derive.from)) {
      problems.push(`${scenario.id}: derives from a later or unknown scenario`);
    }
    if (scenario.expect.sameResponseAs && !earlier(scenario.expect.sameResponseAs)) {
      problems.push(`${scenario.id}: compares response with a later or unknown scenario`);
    }
    if (scenario.repeatOf && !earlier(scenario.repeatOf)) {
      problems.push(`${scenario.id}: repeats a later or unknown scenario`);
    }
    if (scenario.method === "POST" && scenario.body === undefined) {
      problems.push(`${scenario.id}: POST without a body`);
    }
  });
  return problems;
}
