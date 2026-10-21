import { G1_BASE_URL } from "./capture.js";
import { PRINCIPAL_LABELS, NO_SESSION, validSession } from "./principals.js";
import type { DiscoveryRoute } from "./discovery-routes.js";
import type { HttpExpectation, HttpScenario, JsonCheck } from "./scenarios.js";

/** Root integrates this supported extension into its shared comparator. */
export type DiscoveryHttpScenario = Omit<HttpScenario, "expect"> & {
  expect: HttpExpectation & { readonly bodyIncludes?: readonly string[] };
};

export const DISCOVERY_TEXT =
  "Synthetic public result: alpha and beta are independent fixture labels.";
export const DISCOVERY_TITLE = "G1 public discovery fixture";
export const DISCOVERY_VERSION = "g1-discovery-version";
export const DISCOVERY_PUBLICATION = "g1-discovery-publication";
const HIDDEN_TEXT = "Control claim that must stay hidden.";
const TOMBSTONE_TEXT = "Tombstoned discovery claim must never escape.";
const NO_STORE = { "cache-control": "no-store, must-revalidate" } as const;
const json = (pointer: string, equals: unknown): JsonCheck => ({ pointer, equals });
const length = (pointer: string, size: number): JsonCheck => ({ pointer, length: size });
const absent = (pointer: string): JsonCheck => ({ pointer, absent: true });

type Case = {
  id: string;
  route: DiscoveryRoute;
  path: string;
  params?: HttpScenario["params"];
  /** Separate known-equal rate budgets for canonical graph controls. */
  graphRateBucket?: 0 | 1 | 2;
  expect: DiscoveryHttpScenario["expect"];
};
const missing = (message: string): HttpExpectation => ({
  status: 404,
  denial: { code: "not-found", message },
});
const p = (path: string) => `${G1_BASE_URL}${path}`;
const reviewPath = "/api/reviews/g1-fixture-review";
const versionPath = `${reviewPath}/versions/g1-version-2`;
const pubPath = `/api/publications/${DISCOVERY_PUBLICATION}`;
const pubVersionPath = `/api/publication-versions/${DISCOVERY_VERSION}`;

/** Every route has a positive populated fixture, not just a missing-object probe. */
function cases(): Case[] {
  return [
    {
      id: "canonical-graph",
      route: "api/graph",
      path: "/api/graph?seed=g1-node-1&status=confirmed&direction=outgoing",
      graphRateBucket: 0,
      expect: {
        status: 200,
        headers: { ...NO_STORE, "ratelimit-limit": "1000", "ratelimit-remaining": "999" },
        json: [
          length("/edges", 1),
          json("/edges/0/id", "g1-discovery-confirmed-edge"),
          json("/edges/0/status", "confirmed"),
        ],
        bodyExcludes: ["g1-edge-3-unconfirmed", "g1-node-control"],
      },
    },
    {
      id: "canonical-graph-missing",
      route: "api/graph",
      path: "/api/graph?seed=g1-node-missing&status=confirmed",
      graphRateBucket: 1,
      expect: {
        ...missing("Seed node version not found."),
        headers: { ...NO_STORE, "ratelimit-limit": "1000", "ratelimit-remaining": "999" },
      },
    },
    {
      id: "canonical-graph-hidden",
      route: "api/graph",
      path: "/api/graph?seed=g1-node-control&status=confirmed",
      graphRateBucket: 2,
      expect: {
        ...missing("Seed node version not found."),
        headers: { ...NO_STORE, "ratelimit-limit": "1000", "ratelimit-remaining": "999" },
      },
    },
    {
      id: "search-nodes",
      route: "api/search",
      path: "/api/search?contentType=node&nodeKind=claim&sort=title&pageSize=2",
      expect: {
        status: 200,
        json: [json("/total", 3), length("/items", 2), json("/items/0/contentType", "node")],
        bodyExcludes: ["g1-node-control", HIDDEN_TEXT],
      },
    },
    {
      id: "search-nodes-page-2",
      route: "api/search",
      path: "/api/search?contentType=node&nodeKind=claim&sort=title&pageSize=2&page=2",
      expect: {
        status: 200,
        json: [json("/total", 3), length("/items", 1), json("/page", 2)],
        bodyExcludes: ["g1-node-control", HIDDEN_TEXT],
      },
    },
    {
      id: "nodes-list",
      route: "api/nodes",
      path: "/api/nodes?kind=claim&pageSize=2",
      expect: {
        status: 200,
        headers: NO_STORE,
        json: [json("/total", 3), length("/items", 2)],
        bodyExcludes: ["g1-node-control", HIDDEN_TEXT],
      },
    },
    {
      id: "nodes-page-2",
      route: "api/nodes",
      path: "/api/nodes?kind=claim&pageSize=2&page=2",
      expect: {
        status: 200,
        headers: NO_STORE,
        json: [json("/total", 3), json("/page", 2), length("/items", 1)],
        bodyExcludes: ["g1-node-control", HIDDEN_TEXT],
      },
    },
    {
      id: "node",
      route: "api/nodes/[id]",
      path: "/api/nodes/g1-node-1",
      params: { id: "g1-node-1" },
      expect: {
        status: 200,
        headers: NO_STORE,
        json: [
          json("/id", "g1-node-1"),
          json("/version/id", "g1-node-1-v1"),
          json("/version/payload/statement", "Synthetic seed claim statement."),
        ],
        bodyExcludes: ["g1-edge-3-unconfirmed", HIDDEN_TEXT],
      },
    },
    {
      id: "node-missing",
      route: "api/nodes/[id]",
      path: "/api/nodes/g1-node-missing",
      params: { id: "g1-node-missing" },
      expect: missing("Knowledge node not found."),
    },
    {
      id: "node-hidden",
      route: "api/nodes/[id]",
      path: "/api/nodes/g1-node-control",
      params: { id: "g1-node-control" },
      expect: missing("Knowledge node not found."),
    },
    {
      id: "node-versions",
      route: "api/nodes/[id]/versions",
      path: "/api/nodes/g1-node-1/versions",
      params: { id: "g1-node-1" },
      expect: {
        status: 200,
        headers: NO_STORE,
        json: [
          json("/nodeId", "g1-node-1"),
          json("/currentVersionId", "g1-node-1-v1"),
          length("/items", 1),
        ],
      },
    },
    {
      id: "node-version",
      route: "api/nodes/[id]/versions/[versionId]",
      path: "/api/nodes/g1-node-1/versions/g1-node-1-v1",
      params: { id: "g1-node-1", versionId: "g1-node-1-v1" },
      expect: {
        status: 200,
        headers: { "cache-control": "public, max-age=0, must-revalidate" },
        json: [json("/id", "g1-node-1"), json("/version/id", "g1-node-1-v1")],
      },
    },
    {
      id: "node-wrong-version",
      route: "api/nodes/[id]/versions/[versionId]",
      path: "/api/nodes/g1-node-1/versions/g1-node-2-v1",
      params: { id: "g1-node-1", versionId: "g1-node-2-v1" },
      expect: missing("Knowledge node version not found."),
    },
    {
      id: "node-edges",
      route: "api/nodes/[id]/edges",
      path: "/api/nodes/g1-node-1/edges",
      params: { id: "g1-node-1" },
      expect: {
        status: 200,
        headers: NO_STORE,
        json: [
          json("/nodeId", "g1-node-1"),
          length("/edges", 1),
          json("/edges/0/id", "g1-discovery-confirmed-edge"),
          json("/edges/0/status", "confirmed"),
          json("/edges/0/otherNode/id", "g1-node-2"),
        ],
        bodyExcludes: ["g1-edge-3-unconfirmed"],
      },
    },
    {
      id: "passport",
      route: "api/claims/[versionId]/[localClaimId]",
      path: "/api/claims/g1-version-2/claim-1",
      params: { versionId: "g1-version-2", localClaimId: "claim-1" },
      expect: {
        status: 200,
        headers: NO_STORE,
        json: [
          json("/localClaimId", "claim-1"),
          json("/versionId", "g1-version-2"),
          length("/evidence", 1),
          json("/evidence/0/citationLocalId", "ref-1"),
        ],
        bodyExcludes: [HIDDEN_TEXT, TOMBSTONE_TEXT],
      },
    },
    {
      id: "passport-missing",
      route: "api/claims/[versionId]/[localClaimId]",
      path: "/api/claims/g1-version-2/missing-claim",
      params: { versionId: "g1-version-2", localClaimId: "missing-claim" },
      expect: missing("Claim not found."),
    },
    {
      id: "passport-hidden",
      route: "api/claims/[versionId]/[localClaimId]",
      path: "/api/claims/g1-version-3/claim-1",
      params: { versionId: "g1-version-3", localClaimId: "claim-1" },
      expect: missing("Claim not found."),
    },
    {
      id: "passport-tombstoned",
      route: "api/claims/[versionId]/[localClaimId]",
      path: "/api/claims/g1-version-tombstoned/discovery-claim",
      params: { versionId: "g1-version-tombstoned", localClaimId: "discovery-claim" },
      expect: missing("Claim not found."),
    },
    {
      id: "landscape",
      route: "api/landscape",
      path: "/api/landscape?q=Synthetic",
      expect: {
        status: 200,
        headers: NO_STORE,
        json: [
          { pointer: "/recommendations", minLength: 1 },
          json("/algorithm/purpose", "recommendation"),
        ],
        bodyExcludes: [HIDDEN_TEXT, "g1-node-control"],
      },
    },
    {
      id: "review",
      route: "api/reviews/[slug]",
      path: reviewPath,
      params: { slug: "g1-fixture-review" },
      expect: {
        status: 200,
        json: [
          json("/version/id", "g1-version-2"),
          length("/claims", 1),
          length("/citations", 1),
          json("/isTombstoned", false),
        ],
        bodyExcludes: [HIDDEN_TEXT, TOMBSTONE_TEXT],
      },
    },
    {
      id: "review-missing",
      route: "api/reviews/[slug]",
      path: "/api/reviews/g1-missing-review",
      params: { slug: "g1-missing-review" },
      expect: missing("Review not found."),
    },
    {
      id: "review-hidden",
      route: "api/reviews/[slug]",
      path: "/api/reviews/g1-control-review",
      params: { slug: "g1-control-review" },
      expect: missing("Review not found."),
    },
    {
      id: "review-version",
      route: "api/reviews/[slug]/versions/[versionId]",
      path: versionPath,
      params: { slug: "g1-fixture-review", versionId: "g1-version-2" },
      expect: { status: 200, json: [json("/version/id", "g1-version-2"), length("/claims", 1)] },
    },
    {
      id: "review-tombstone",
      route: "api/reviews/[slug]/versions/[versionId]",
      path: `${reviewPath}/versions/g1-version-tombstoned`,
      params: { slug: "g1-fixture-review", versionId: "g1-version-tombstoned" },
      expect: {
        status: 200,
        json: [
          json("/title", "Content unavailable"),
          json("/isTombstoned", true),
          length("/claims", 0),
          length("/citations", 0),
          length("/contributors", 0),
          absent("/version/semanticVersion"),
        ],
        bodyExcludes: [TOMBSTONE_TEXT, "G1 tombstoned attachment control"],
      },
    },
    {
      id: "review-wrong-version",
      route: "api/reviews/[slug]/versions/[versionId]",
      path: `${reviewPath}/versions/g1-version-4`,
      params: { slug: "g1-fixture-review", versionId: "g1-version-4" },
      expect: missing("Review version not found."),
    },
    {
      id: "diff",
      route: "api/reviews/[slug]/diff",
      path: `${reviewPath}/diff?from=g1-version-1&to=g1-version-2`,
      params: { slug: "g1-fixture-review" },
      expect: {
        status: 200,
        headers: { ...NO_STORE, pragma: "no-cache" },
        json: [
          json("/from/versionId", "g1-version-1"),
          json("/to/versionId", "g1-version-2"),
          json("/sections/claims/added", ["claim-1"]),
          json("/sections/assets/added", ["article.md"]),
        ],
      },
    },
    {
      id: "diff-tombstone",
      route: "api/reviews/[slug]/diff",
      path: `${reviewPath}/diff?from=g1-version-2&to=g1-version-tombstoned`,
      params: { slug: "g1-fixture-review" },
      expect: missing("Comparable review versions not found."),
    },
    {
      id: "publication",
      route: "api/publications/[id]",
      path: pubPath,
      params: { id: DISCOVERY_PUBLICATION },
      expect: {
        status: 200,
        json: [
          json("/id", DISCOVERY_PUBLICATION),
          length("/versions", 1),
          json("/versions/0/id", DISCOVERY_VERSION),
        ],
      },
    },
    {
      id: "publication-missing",
      route: "api/publications/[id]",
      path: "/api/publications/g1-missing-publication",
      params: { id: "g1-missing-publication" },
      expect: missing("Publication not found."),
    },
    {
      id: "publication-relations",
      route: "api/publications/[id]/relations",
      path: `${pubPath}/relations`,
      params: { id: DISCOVERY_PUBLICATION },
      expect: {
        status: 200,
        json: [
          length("/relations", 1),
          json("/relations/0/relationType", "derived-from"),
          json("/relations/0/direction", "outgoing"),
        ],
      },
    },
    {
      id: "publication-version",
      route: "api/publication-versions/[id]",
      path: pubVersionPath,
      params: { id: DISCOVERY_VERSION },
      expect: {
        status: 200,
        json: [
          json("/id", DISCOVERY_VERSION),
          json("/publicationId", DISCOVERY_PUBLICATION),
          length("/captures", 2),
          json("/claimOccurrenceCount", 1),
          json("/contributorCount", 1),
          json("/productionAssertionCount", 1),
        ],
      },
    },
    {
      id: "publication-content",
      route: "api/publication-versions/[id]/content",
      path: `${pubVersionPath}/content`,
      params: { id: DISCOVERY_VERSION },
      expect: {
        status: 200,
        json: [
          length("/content", 1),
          json("/content/0/text", DISCOVERY_TEXT),
          json("/completeness/coverage", "complete"),
        ],
      },
    },
    {
      id: "publication-contributors",
      route: "api/publication-versions/[id]/contributors",
      path: `${pubVersionPath}/contributors`,
      params: { id: DISCOVERY_VERSION },
      expect: {
        status: 200,
        json: [
          length("/contributors", 1),
          json("/contributors/0/displayName", "G1 Discovery Author"),
          json("/contributors/0/roles", ["author"]),
        ],
      },
    },
    {
      id: "publication-production",
      route: "api/publication-versions/[id]/production-provenance",
      path: `${pubVersionPath}/production-provenance`,
      params: { id: DISCOVERY_VERSION },
      expect: {
        status: 200,
        json: [
          length("/assertions", 1),
          json("/assertions/0/strength", "source-declared"),
          json("/assertions/0/actors/0/kind", "software"),
        ],
      },
    },
    {
      id: "publication-occurrence",
      route: "api/publication-claim-occurrences/[id]",
      path: "/api/publication-claim-occurrences/g1-discovery-occurrence",
      params: { id: "g1-discovery-occurrence" },
      expect: {
        status: 200,
        json: [
          json("/sourceLocalClaimId", "synthetic-result"),
          json("/text", DISCOVERY_TEXT),
          json("/canonicalBinding", null),
        ],
      },
    },
    {
      id: "publication-occurrence-missing",
      route: "api/publication-claim-occurrences/[id]",
      path: "/api/publication-claim-occurrences/g1-missing-occurrence",
      params: { id: "g1-missing-occurrence" },
      expect: missing("Publication claim occurrence not found."),
    },
  ];
}

const FORMATS = {
  csl: {
    media: "application/vnd.citationstyles.csl+json; charset=utf-8",
    extension: "csl.json",
    json: [
      json("/0/title", 'G1 fixture review v2 & "quoted"'),
      json("/0/id", "g1-fixture-review:g1-version-2"),
    ],
  },
  bibtex: {
    media: "application/x-bibtex; charset=utf-8",
    extension: "bib",
    bodyIncludes: ["@misc{g1-fixture-review-2026,", 'title = {G1 fixture review v2 \\& "quoted"}'],
  },
  ris: {
    media: "application/x-research-info-systems; charset=utf-8",
    extension: "ris",
    bodyIncludes: ["TY  - GEN", 'TI  - G1 fixture review v2 & "quoted"', "ER  -"],
  },
  jats: {
    media: "application/xml; charset=utf-8",
    extension: "jats.xml",
    bodyIncludes: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "G1 fixture review v2 &amp; &quot;quoted&quot;",
    ],
  },
  "ro-crate": {
    media: "application/ld+json; charset=utf-8",
    extension: "ro-crate-metadata.json",
    json: [
      json("/@context", "https://w3id.org/ro/crate/1.1/context"),
      { pointer: "/@graph", minLength: 2 },
    ],
  },
  prov: {
    media: "application/ld+json; charset=utf-8",
    extension: "prov.jsonld",
    json: [{ pointer: "/@graph", minLength: 2 }],
    bodyIncludes: [
      "Repository state 2222222222222222222222222222222222222222",
      'G1 fixture review v2 & \\"quoted\\"',
    ],
  },
  package: {
    media: "application/json; charset=utf-8",
    extension: "preservation.json",
    json: [
      json("/version/id", "g1-version-2"),
      json("/review/title", 'G1 fixture review v2 & "quoted"'),
      json("/preservedContentAvailable", true),
      { pointer: "/files", minLength: 1 },
    ],
  },
  json: {
    media: "application/vnd.oratlas.scholarly+json; charset=utf-8",
    extension: "scholarly.json",
    json: [json("/schemaVersion", "1.1.0")],
    bodyIncludes: ['G1 fixture review v2 & \\"quoted\\"'],
  },
  docmap: {
    media: "application/ld+json; charset=utf-8",
    extension: "docmap.json",
    json: [json("/type", "docmap")],
    bodyIncludes: [p("/reviews/g1-fixture-review/versions/g1-version-2")],
  },
} satisfies Record<
  string,
  { media: string; extension: string; json?: JsonCheck[]; bodyIncludes?: string[] }
>;

function exportCases(): Case[] {
  const route = "api/reviews/[slug]/versions/[versionId]/export/[format]" as const;
  const positive: Case[] = Object.entries(FORMATS).map(([format, config]) => {
    const { media, extension, ...assertions } = config;
    return {
      id: `export-${format}`,
      route,
      path: `${versionPath}/export/${format}`,
      params: { slug: "g1-fixture-review", versionId: "g1-version-2", format },
      expect: {
        status: 200,
        ...assertions,
        headers: {
          "content-type": media,
          "content-disposition": `attachment; filename="g1-fixture-review-g1-version-2.${extension}"`,
          "x-content-type-options": "nosniff",
          ...NO_STORE,
          pragma: "no-cache",
        },
        bodyExcludes: [TOMBSTONE_TEXT, HIDDEN_TEXT],
      },
    };
  });
  for (const state of ["missing", "tombstoned"] as const) {
    const versionId = state === "missing" ? "g1-missing-version" : "g1-version-tombstoned";
    for (const format of Object.keys(FORMATS))
      positive.push({
        id: `export-${format}-${state}`,
        route,
        path: `${reviewPath}/versions/${versionId}/export/${format}`,
        params: { slug: "g1-fixture-review", versionId, format },
        expect: { ...missing("Review version not found."), bodyExcludes: [TOMBSTONE_TEXT] },
      });
  }
  return positive;
}

/** Add after the common fixture reset, before any new discovery mutations. */
export function publicDiscoveryScenarios(): readonly DiscoveryHttpScenario[] {
  const result: DiscoveryHttpScenario[] = [];
  const all = [...cases(), ...exportCases()];
  for (const principal of PRINCIPAL_LABELS) {
    const key = principal.toLowerCase().replace("+", "-and-");
    const session = principal === "anonymous" ? NO_SESSION : validSession(principal);
    for (const entry of all)
      result.push({
        kind: "http",
        id: `discovery-${entry.id}-${key}`,
        method: "GET",
        route: entry.route,
        path: entry.path,
        params: entry.params,
        ...(entry.graphRateBucket === undefined
          ? {}
          : {
              headers: {
                "x-forwarded-for": `192.0.2.${20 + PRINCIPAL_LABELS.indexOf(principal) * 3 + entry.graphRateBucket}`,
              },
            }),
        principal,
        session,
        expect: {
          ...entry.expect,
          ...(principal === "anonymous"
            ? {}
            : { sameResponseAs: `discovery-${entry.id}-anonymous` }),
        },
      });
  }
  return result;
}
