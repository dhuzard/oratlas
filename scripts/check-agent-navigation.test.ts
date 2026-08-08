import { describe, expect, it } from "vitest";

import {
  AgentContractError,
  checkAgentNavigation,
  HOSTILE_ARCHIVED_TEXT,
  parseBaseUrl,
  type FetchLike,
} from "./check-agent-navigation";

const ORIGIN = "https://atlas.test";
const SLUG = "hippocampal-replay-computational-review";
const VERSION = "version-1";
const CLAIM = "claim-hostile";
const GRAPH_CLAIM = "claim-001";
const NODE = "node-1";
const NODE_VERSION = "node-version-1";

const links = {
  current: `/api/reviews/${SLUG}`,
  currentHtml: `/reviews/${SLUG}`,
  exact: `/api/reviews/${SLUG}/versions/${VERSION}`,
  exactHtml: `/reviews/${SLUG}/versions/${VERSION}`,
  claim: `/api/claims/${VERSION}/${CLAIM}`,
  claimHtml: `/claims/${VERSION}/${CLAIM}`,
  graphClaim: `/api/claims/${VERSION}/${GRAPH_CLAIM}`,
  graph: `/api/graph?seed=${NODE}&version=${NODE_VERSION}&status=authoritative`,
};

const openapi = `openapi: 3.1.0
paths:
  /api/search:
    get: {}
  /api/reviews/{slug}:
    get: {}
  /api/reviews/{slug}/versions/{versionId}:
    get: {}
  /api/claims/{versionId}/{localClaimId}:
    get: {}
  /api/graph:
    get:
      responses:
        "429":
          headers:
            Retry-After:
              schema:
                type: integer
`;

const advertisedPaths = [
  "/api-docs",
  "/openapi.yaml",
  "/openapi.json",
  "/api-docs/agents",
  "/api/search",
  "/api/graph",
  "/api/feeds/lifecycle",
  "/archive",
  "/explore",
  "/create-review",
];

function text(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return Response.json(body, init);
}

function graphResponse(
  edge: {
    id: string;
    status: "source-assertion" | "confirmed";
    provenance: "imported-from-review" | "confirmed-by-editor";
  },
  nextCursor?: string,
): Response {
  const headers = new Headers({
    "RateLimit-Limit": "100",
    "RateLimit-Remaining": "99",
    "RateLimit-Reset": "60",
  });
  if (nextCursor) {
    headers.set(
      "Link",
      `<${ORIGIN}/api-docs/agents>; rel="service", </api/graph?seed=${NODE}&status=authoritative&limit=2&cursor=${nextCursor}>; rel="next"`,
    );
  }
  return json(
    {
      schemaVersion: "2.0.0",
      seed: { nodeId: NODE, nodeVersionId: NODE_VERSION },
      nodes: [
        { nodeId: NODE, nodeVersionId: NODE_VERSION },
        { nodeId: "target", nodeVersionId: "target-version" },
      ],
      edges: [
        {
          ...edge,
          sourceNodeId: NODE,
          sourceNodeVersionId: NODE_VERSION,
          targetNodeId: "target",
          targetNodeVersionId: "target-version",
          ...(edge.status === "confirmed" ? { confirmedAt: "2026-08-05T12:00:00.000Z" } : {}),
        },
      ],
      page: { limit: 2, ...(nextCursor ? { nextCursor } : {}) },
    },
    { headers },
  );
}

function createFetch(options: { crossOriginDiscovery?: boolean; badNextQuery?: boolean } = {}): {
  fetchImpl: FetchLike;
  requests: Array<{ method: string; url: URL }>;
} {
  const requests: Array<{ method: string; url: URL }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    requests.push({ method: init?.method ?? "GET", url });

    if (url.pathname === "/llms.txt") {
      const urls = advertisedPaths.map((path) => `[entry](${ORIGIN}${path})`);
      if (options.crossOriginDiscovery) urls.push("[bad](https://evil.test/archive)");
      return text(urls.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/openapi.yaml") return text(openapi);
    if (
      advertisedPaths.includes(url.pathname) &&
      url.pathname !== "/api/search" &&
      url.pathname !== "/api/graph"
    ) {
      return text("entry point");
    }
    if (url.pathname === "/api/search" && !url.search) return json({ items: [] });
    if (url.pathname === "/api/graph" && !url.searchParams.has("seed"))
      return json({ error: "seed required" }, { status: 400 });

    if (url.pathname === "/api/search") {
      expect(Object.fromEntries(url.searchParams)).toEqual({
        contentType: "review",
        q: "hippocampal replay",
        sort: "relevance",
        pageSize: "5",
      });
      return json({
        items: [
          {
            slug: SLUG,
            links: { self: links.current, html: links.currentHtml, exactVersion: links.exact },
          },
        ],
      });
    }
    if (url.pathname === links.current) {
      return json({
        slug: SLUG,
        version: { id: VERSION },
        claims: [],
        links: { self: links.current, html: links.currentHtml, exactVersion: links.exact },
      });
    }
    if (url.pathname === links.currentHtml) {
      return text(
        `<html><head><link rel="canonical" href="${ORIGIN}${links.currentHtml}"></head></html>`,
      );
    }
    if (url.pathname === links.exact) {
      return json({
        slug: SLUG,
        version: { id: VERSION },
        claims: [
          {
            localClaimId: CLAIM,
            text: HOSTILE_ARCHIVED_TEXT,
            links: { self: links.claim, html: links.claimHtml },
          },
          {
            localClaimId: GRAPH_CLAIM,
            text: "Replay supports systems memory consolidation.",
            links: {
              self: links.graphClaim,
              html: `/claims/${VERSION}/${GRAPH_CLAIM}`,
            },
          },
        ],
        links: { self: links.exact, html: links.exactHtml, exactVersion: links.exact },
      });
    }
    if (url.pathname === links.exactHtml) {
      return text(`<html><head><link href="${links.exactHtml}" rel="canonical"></head></html>`);
    }
    if (url.pathname === links.claim) {
      return json({
        claimId: "claim:canonical:1",
        localClaimId: CLAIM,
        reviewSlug: SLUG,
        versionId: VERSION,
        text: HOSTILE_ARCHIVED_TEXT,
        graphIdentity: { nodeId: NODE, nodeVersionId: NODE_VERSION },
        links: {
          self: links.claim,
          html: links.claimHtml,
          review: links.current,
          reviewVersion: links.exact,
          graph: links.graph,
        },
      });
    }
    if (url.pathname === links.claimHtml) return text("<main>claim:canonical:1</main>");
    if (url.pathname === links.graphClaim) {
      return json({
        claimId: "claim:graph:1",
        localClaimId: GRAPH_CLAIM,
        reviewSlug: SLUG,
        versionId: VERSION,
        text: "Replay supports systems memory consolidation.",
        graphIdentity: { nodeId: NODE, nodeVersionId: NODE_VERSION },
        links: {
          self: links.graphClaim,
          html: `/claims/${VERSION}/${GRAPH_CLAIM}`,
          review: links.current,
          reviewVersion: links.exact,
          graph: links.graph,
        },
      });
    }
    if (url.pathname === "/api/graph") {
      const exact = url.searchParams.has("version");
      const cursor = url.searchParams.get("cursor");
      if (!cursor) {
        const response = graphResponse(
          {
            id: exact ? "exact-source" : "stable-source",
            status: "source-assertion",
            provenance: "imported-from-review",
          },
          exact ? "exact-2" : "stable-2",
        );
        if (exact) {
          response.headers.set(
            "Link",
            `<${ORIGIN}/api-docs/agents>; rel="service", </api/graph?seed=${NODE}&version=${NODE_VERSION}&status=authoritative&limit=2&cursor=exact-2>; rel="next"`,
          );
        } else if (options.badNextQuery) {
          response.headers.set(
            "Link",
            `</api/graph?seed=${NODE}&limit=2&cursor=stable-2>; rel="next"`,
          );
        }
        return response;
      }
      return graphResponse(
        exact
          ? { id: "exact-source-2", status: "source-assertion", provenance: "imported-from-review" }
          : { id: "stable-confirmed", status: "confirmed", provenance: "confirmed-by-editor" },
      );
    }
    return text("not found", { status: 404 });
  };
  return { fetchImpl, requests };
}

describe("parseBaseUrl", () => {
  it("uses the positional URL before BASE_URL and normalizes it", () => {
    expect(parseBaseUrl(["https://atlas.test/"], { BASE_URL: "https://ignored.test" }).href).toBe(
      `${ORIGIN}/`,
    );
    expect(parseBaseUrl([], { BASE_URL: ORIGIN }).href).toBe(`${ORIGIN}/`);
  });

  it("rejects missing, path-scoped, and extra arguments", () => {
    expect(() => parseBaseUrl([], {})).toThrow(AgentContractError);
    expect(() => parseBaseUrl([`${ORIGIN}/archive`], {})).toThrow(/origin/);
    expect(() => parseBaseUrl([ORIGIN, "extra"], {})).toThrow(/Usage/);
  });
});

describe("checkAgentNavigation", () => {
  it("follows only contract links and preserves hostile archived text as inert data", async () => {
    const { fetchImpl, requests } = createFetch();
    const result = await checkAgentNavigation(new URL(ORIGIN), fetchImpl);

    expect(result).toMatchObject({
      status: "ok",
      reviewSlug: SLUG,
      versionId: VERSION,
      claimId: "claim:canonical:1",
      hostileArchivedTextPreserved: true,
      exactGraph: { pages: 2, edges: 2 },
      stableGraph: { pages: 2, edges: 2, statuses: ["confirmed", "source-assertion"] },
    });
    expect(requests.every((entry) => entry.method === "GET" && entry.url.origin === ORIGIN)).toBe(
      true,
    );
    expect(
      requests.some((entry) => entry.url.href.includes(encodeURIComponent(HOSTILE_ARCHIVED_TEXT))),
    ).toBe(false);
  });

  it("rejects cross-origin discovery links before requesting them", async () => {
    const { fetchImpl, requests } = createFetch({ crossOriginDiscovery: true });
    await expect(checkAgentNavigation(new URL(ORIGIN), fetchImpl)).rejects.toThrow(/cross-origin/);
    expect(requests.some((entry) => entry.url.origin === "https://evil.test")).toBe(false);
  });

  it("rejects a rel=next URL that drops a graph query parameter", async () => {
    const { fetchImpl } = createFetch({ badNextQuery: true });
    await expect(checkAgentNavigation(new URL(ORIGIN), fetchImpl)).rejects.toThrow(
      /preserve all non-cursor/,
    );
  });
});
