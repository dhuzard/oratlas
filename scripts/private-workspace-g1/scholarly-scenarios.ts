import { NO_SESSION, PRINCIPAL_LABELS, validSession, type PrincipalLabel } from "./principals.js";
import type { HttpExpectation, HttpScenario } from "./scenarios.js";
import type { SCHOLARLY_ROUTES } from "./scholarly-routes.js";

const slug = "g1-fixture-review";
const versionId = "g1-version-2";
const versionBase = `/api/reviews/${slug}/versions/${versionId}`;
const excluded = [
  "G1_REMOVED_COMMENT_CANARY",
  "G1_REMOVED_ALONE_CANARY",
  "G1_REMOVED_CHALLENGE_CANARY",
  "G1_REMOVED_RESPONSE_CANARY",
  "G1_TOMBSTONE_COMMENT_CANARY",
  "G1_RAW_PROTOCOL_CANARY",
];
const session = (principal: PrincipalLabel) =>
  principal === "anonymous" ? NO_SESSION : validSession(principal);
const cases: HttpScenario[] = [];
function all(
  name: string,
  route: keyof typeof SCHOLARLY_ROUTES,
  path: string,
  params: HttpScenario["params"],
  expect: HttpExpectation,
) {
  for (const principal of PRINCIPAL_LABELS)
    cases.push({
      kind: "http",
      id: `scholar-${name}-${principal.toLowerCase().replaceAll("+", "-")}`,
      route,
      method: "GET",
      path,
      params,
      principal,
      session: session(principal),
      expect: {
        ...expect,
        bodyExcludes: [...excluded, ...(expect.bodyExcludes ?? [])],
        ...(principal !== "anonymous" ? { sameResponseAs: `scholar-${name}-anonymous` } : {}),
      },
    });
}
const absent = (message: string): HttpExpectation => ({
  status: 404,
  denial: { code: "not-found", message },
});
const bad = (message: string): HttpExpectation => ({
  status: 400,
  denial: { code: "bad-request", message },
});
const currentComments: HttpExpectation = {
  status: 200,
  json: [
    { pointer: "/reviewVersionId", equals: versionId },
    { pointer: "/commentCount", equals: 2 },
    { pointer: "/comments", length: 2 },
    { pointer: "/comments/0/id", equals: "g1-comment-visible" },
    { pointer: "/comments/0/body", equals: "Visible synthetic scholarly comment." },
    { pointer: "/comments/1/author", equals: null },
    { pointer: "/comments/1/body", equals: "" },
    { pointer: "/comments/1/replies/0/id", equals: "g1-comment-reply" },
  ],
};
all(
  "comments-current",
  "api/reviews/[slug]/comments",
  `/api/reviews/${slug}/comments`,
  { slug },
  currentComments,
);
all(
  "comments-version",
  "api/reviews/[slug]/versions/[versionId]/comments",
  `${versionBase}/comments`,
  { slug, versionId },
  currentComments,
);
all(
  "comments-history",
  "api/reviews/[slug]/versions/[versionId]/comments",
  `/api/reviews/${slug}/versions/g1-version-1/comments`,
  { slug, versionId: "g1-version-1" },
  {
    status: 200,
    json: [
      { pointer: "/commentCount", equals: 1 },
      { pointer: "/comments/0/id", equals: "g1-comment-historical" },
    ],
    bodyExcludes: ["g1-comment-visible"],
  },
);
all(
  "annotations",
  "api/reviews/[slug]/versions/[versionId]/annotations",
  `${versionBase}/annotations`,
  { slug, versionId },
  {
    status: 200,
    headers: { "content-type": "application/ld+json; charset=utf-8" },
    json: [
      { pointer: "/type", equals: "AnnotationPage" },
      { pointer: "/items", length: 2 },
      { pointer: "/items/0/body/value", equals: "Visible synthetic scholarly comment." },
      { pointer: "/items/1/body/value", equals: "Visible synthetic reply under removed parent." },
    ],
  },
);
for (const kind of ["comments", "annotations"] as const) {
  const route = `api/reviews/[slug]/versions/[versionId]/${kind}` as const;
  all(
    `${kind}-tombstone`,
    route,
    `/api/reviews/${slug}/versions/g1-version-tombstoned/${kind}`,
    { slug, versionId: "g1-version-tombstoned" },
    { status: 200, json: [{ pointer: kind === "comments" ? "/comments" : "/items", length: 0 }] },
  );
  all(
    `${kind}-wrong-version`,
    route,
    `/api/reviews/${slug}/versions/g1-version-4/${kind}`,
    { slug, versionId: "g1-version-4" },
    absent("Review version not found."),
  );
}
all(
  "comments-missing",
  "api/reviews/[slug]/comments",
  "/api/reviews/g1-missing-review/comments",
  { slug: "g1-missing-review" },
  absent("Review not found."),
);
all(
  "comments-hidden",
  "api/reviews/[slug]/comments",
  "/api/reviews/g1-control-review/comments",
  { slug: "g1-control-review" },
  absent("Review not found."),
);
all(
  "challenges",
  "api/reviews/[slug]/versions/[versionId]/challenges",
  `${versionBase}/challenges`,
  { slug, versionId },
  {
    status: 200,
    json: [
      { pointer: "/challenges", length: 2 },
      { pointer: "/challenges/0/id", equals: "g1-challenge-removed" },
      { pointer: "/challenges/0/body", equals: "" },
      {
        pointer: "/challenges/1/body",
        equals: "Synthetic dismissed challenge with recorded editorial outcome.",
      },
      { pointer: "/challenges/1/status", equals: "dismissed" },
      { pointer: "/challenges/1/transitions", length: 3 },
      { pointer: "/challenges/0/response/body", equals: "" },
      {
        pointer: "/challenges/1/response/body",
        equals: "Synthetic contributor response before editorial dismissal.",
      },
    ],
  },
);
all(
  "challenges-tombstone",
  "api/reviews/[slug]/versions/[versionId]/challenges",
  `/api/reviews/${slug}/versions/g1-version-tombstoned/challenges`,
  { slug, versionId: "g1-version-tombstoned" },
  absent("Review version not found."),
);
all(
  "node-challenges-empty",
  "api/nodes/[id]/challenges",
  "/api/nodes/g1-node-1/challenges",
  { id: "g1-node-1" },
  {
    status: 200,
    json: [
      { pointer: "/nodeId", equals: "g1-node-1" },
      { pointer: "/challenges", length: 0 },
      { pointer: "/nextCursor", equals: null },
    ],
  },
);
all(
  "node-challenges-limit",
  "api/nodes/[id]/challenges",
  "/api/nodes/g1-node-1/challenges?limit=0",
  { id: "g1-node-1" },
  bad("limit must be an integer from 1 to 100."),
);
all(
  "node-challenges-hidden",
  "api/nodes/[id]/challenges",
  "/api/nodes/g1-node-control/challenges",
  { id: "g1-node-control" },
  absent("Knowledge node not found."),
);
all("replications-list", "api/replications", "/api/replications", undefined, {
  status: 200,
  headers: { "cache-control": "no-store, must-revalidate" },
  json: [
    { pointer: "/total", equals: 1 },
    { pointer: "/briefs", length: 1 },
    { pointer: "/briefs/0/slug", equals: "g1-replication-public" },
    { pointer: "/briefs/0/claims", length: 1 },
  ],
  bodyExcludes: ["g1-replication-draft", "g1-replication-hidden-claim"],
});
all(
  "replication-detail",
  "api/replications/[slug]",
  "/api/replications/g1-replication-public",
  { slug: "g1-replication-public" },
  {
    status: 200,
    json: [
      { pointer: "/slug", equals: "g1-replication-public" },
      { pointer: "/status", equals: "open" },
      { pointer: "/claims/0/reviewVersionId", equals: versionId },
      { pointer: "/createdByLogin", equals: "g1-fixture-editor" },
    ],
    bodyExcludes: ["createdById", "g1-user-editor"],
  },
);
for (const hidden of ["g1-replication-draft", "g1-replication-hidden-claim", "g1-missing-brief"])
  all(
    `replication-${hidden}`,
    "api/replications/[slug]",
    `/api/replications/${hidden}`,
    { slug: hidden },
    absent("Replication brief not found."),
  );
all(
  "replications-malformed",
  "api/replications",
  "/api/replications?page=0",
  undefined,
  bad("Invalid marketplace query."),
);
all(
  "protocol-summary",
  "api/protocols/reviews/[versionId]",
  `/api/protocols/reviews/${versionId}`,
  { versionId },
  {
    status: 200,
    headers: { "cache-control": "no-store, must-revalidate" },
    json: [
      { pointer: "/reviewVersionId", equals: versionId },
      { pointer: "/openCount", equals: 1 },
      { pointer: "/snapshots", length: 1 },
      { pointer: "/snapshots/0/id", equals: "g1-protocol-snapshot" },
      { pointer: "/snapshots/0/normalized/title", equals: "Synthetic registered protocol" },
      { pointer: "/snapshots/0/proposals", length: 1 },
    ],
    bodyExcludes: ["rawJson", "observedJson", "createdById"],
  },
);
for (const hidden of ["g1-version-tombstoned", "g1-version-3", "g1-missing-version"])
  all(
    `protocol-${hidden}`,
    "api/protocols/reviews/[versionId]",
    `/api/protocols/reviews/${hidden}`,
    { versionId: hidden },
    absent("Review version not found."),
  );

// Requires the typed ChallengeError route boundary fix (745a480) in integration.
all(
  "node-challenges-cursor",
  "api/nodes/[id]/challenges",
  "/api/nodes/g1-node-1/challenges?cursor=invalid",
  { id: "g1-node-1" },
  bad("Invalid node challenge cursor."),
);
for (const format of ["challenges.json", "challenges-ro-crate"] as const) {
  const route = `api/nodes/[id]/exports/${format}` as const;
  all(
    `node-${format}-cursor`,
    route,
    `/api/nodes/g1-node-1/exports/${format}?cursor=invalid`,
    { id: "g1-node-1" },
    bad("Invalid node challenge cursor."),
  );
  all(
    `node-${format}-empty`,
    route,
    `/api/nodes/g1-node-1/exports/${format}`,
    { id: "g1-node-1" },
    {
      status: 200,
      headers: {
        "content-type":
          format === "challenges.json"
            ? "application/vnd.oratlas.node-challenges+json; charset=utf-8"
            : "application/ld+json; charset=utf-8",
      },
      json:
        format === "challenges.json"
          ? [
              { pointer: "/schemaVersion", equals: "1.0.0" },
              { pointer: "/node/id", equals: "g1-node-1" },
              { pointer: "/challenges", length: 0 },
              { pointer: "/nextCursor", equals: null },
            ]
          : [
              { pointer: "/@context", equals: "https://w3id.org/ro/crate/1.1/context" },
              { pointer: "/@graph", length: 3 },
              { pointer: "/@graph/1/@type", equals: "Dataset" },
              { pointer: "/@graph/1/mentions", length: 0 },
            ],
    },
  );
  all(
    `node-${format}-hidden`,
    route,
    `/api/nodes/g1-node-control/exports/${format}?cursor=invalid`,
    { id: "g1-node-control" },
    absent("Knowledge node not found."),
  );
}

/** Declarative only; real handler/database evidence is produced by root integration. */
export const SCHOLARLY_SCENARIOS: readonly HttpScenario[] = cases;
