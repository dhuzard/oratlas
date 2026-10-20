import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  atomEntryIds,
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  sha256Hex,
  type CaptureFile,
  type CapturedResponse,
} from "./capture.js";
import {
  comparePairedCaptures,
  compareWithGolden,
  GOLDEN_TEXT_LIMIT,
  goldenCandidate,
  type GoldenFile,
} from "./compare.js";

// Offline: synthetic captures only.
function response(
  id: string,
  body: string,
  overrides: Partial<CapturedResponse> = {},
): CapturedResponse {
  const bytes = Buffer.from(body, "utf8");
  return {
    id,
    request: { id, method: "GET", path: `/${id}`, headers: {} },
    status: 200,
    headers: [
      ["content-type", "text/plain"],
      ["link", "<a>; rel=x, <b>; rel=y"],
    ],
    setCookie: [],
    bodyBase64: bytes.toString("base64"),
    bodySha256: sha256Hex(bytes),
    bodyLength: bytes.byteLength,
    ...overrides,
  };
}

function capture(responses: readonly CapturedResponse[], label = "baseline"): CaptureFile {
  return {
    version: 1,
    label,
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    principal: "anonymous",
    responses,
  };
}

const atom = `<feed>\n  <entry>\n    <id>https://x/2</id>\n  </entry>\n  <entry>\n    <id>https://x/1</id>\n  </entry>\n</feed>\n`;

describe("paired capture comparison", () => {
  const before = capture([response("a", "alpha"), response("b", "beta")]);

  it("accepts byte-identical captures", () => {
    expect(comparePairedCaptures(before, capture(before.responses, "after"))).toEqual([]);
  });

  it("flags body, status, header, multi-value header and set-cookie changes", () => {
    const changed = (patch: Partial<CapturedResponse>) =>
      comparePairedCaptures(
        before,
        capture([{ ...before.responses[0]!, ...patch }, before.responses[1]!]),
      );
    expect(changed({ bodyBase64: Buffer.from("alphA").toString("base64") })).toEqual([
      "a: body bytes differ",
    ]);
    expect(changed({ status: 304 })).toEqual(["a: status 200 != 304"]);
    expect(changed({ headers: [["content-type", "text/plain"]] })).toEqual(["a: headers differ"]);
    expect(
      changed({
        headers: [
          ["content-type", "text/plain"],
          ["link", "<b>; rel=y, <a>; rel=x"],
        ],
      }),
    ).toEqual(["a: headers differ"]);
    expect(changed({ setCookie: ["s=1"] })).toEqual(["a: set-cookie differs"]);
    expect(changed({ headers: [...before.responses[0]!.headers, ["x-cache", "HIT"]] })).toEqual([
      "a: headers differ",
    ]);
  });

  it("normalizes only date and request-id headers", () => {
    const after = capture([
      {
        ...before.responses[0]!,
        headers: [...before.responses[0]!.headers, ["date", "now"], ["x-request-id", "r1"]],
      },
      before.responses[1]!,
    ]);
    expect(comparePairedCaptures(before, after)).toEqual([]);
  });

  it("flags missing, extra or reordered routes and empty captures", () => {
    expect(comparePairedCaptures(before, capture([before.responses[0]!]))).toHaveLength(1);
    expect(
      comparePairedCaptures(before, capture([before.responses[1]!, before.responses[0]!])),
    ).toHaveLength(1);
    expect(comparePairedCaptures(capture([]), capture([]))).toEqual(["captures are empty"]);
  });
});

describe("golden comparison", () => {
  it("accepts a capture against its reviewed candidate and stores large bodies by hash", () => {
    const large = "x".repeat(GOLDEN_TEXT_LIMIT + 1);
    const base = capture([
      response("small", "ok"),
      response("large", large),
      response("feed", atom, {
        headers: [["content-type", "application/atom+xml; charset=utf-8"]],
      }),
    ]);
    const golden = goldenCandidate(base, "test");
    expect(golden.routes[0]!.body).toEqual({ encoding: "utf8", text: "ok" });
    expect(golden.routes[1]!.body).toEqual({
      sha256: sha256Hex(Buffer.from(large)),
      length: large.length,
    });
    expect(golden.routes[2]!.atomEntryIds).toEqual(["https://x/2", "https://x/1"]);
    expect(compareWithGolden(base, golden)).toEqual([]);
  });

  it("rejects equal error responses as evidence even when paired captures match", () => {
    const errors = capture([response("feed", '{"error":"internal"}', { status: 500 })]);
    expect(comparePairedCaptures(errors, errors)).toEqual([]);
    const golden = goldenCandidate(errors, "test");
    expect(compareWithGolden(errors, golden)).toContain(
      "feed (golden): golden must not record an error status",
    );
  });

  it("rejects an empty 200 body and a feed that lost or reordered entries", () => {
    const empty = capture([response("health", "")]);
    expect(compareWithGolden(empty, goldenCandidate(empty, "t"))).toContain(
      "health (golden): 200 response has an empty body",
    );
    const feed = capture([
      response("feed", atom, { headers: [["content-type", "application/atom+xml"]] }),
    ]);
    const golden = goldenCandidate(feed, "t");
    const reordered = atom.replace("x/2", "x/TMP").replace("x/1", "x/2").replace("x/TMP", "x/1");
    const differences = compareWithGolden(
      capture([
        response("feed", reordered, { headers: [["content-type", "application/atom+xml"]] }),
      ]),
      golden,
    );
    expect(differences).toContain("feed (golden): feed entry count/order differs");
    expect(differences).toContain("feed (golden): body bytes differ");
  });
});

describe("reviewed G1 golden baseline", () => {
  const golden = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "scripts/private-workspace-g1/baselines/public-routes.golden.json"),
      "utf8",
    ),
  ) as GoldenFile;
  const route = (id: string) => golden.routes.find((entry) => entry.id === id)!;

  it("records only successful/not-modified, non-empty responses with a non-empty feed", () => {
    for (const entry of golden.routes) {
      expect([200, 304], entry.id).toContain(entry.status);
      if (entry.status === 200) {
        expect("text" in entry.body ? entry.body.text.length : entry.body.length).toBeGreaterThan(
          0,
        );
      }
    }
    const feed = route("feeds-atom");
    expect(feed.atomEntryIds).toEqual([
      `${G1_BASE_URL}/reviews/g1-fixture-review/versions/g1-version-2`,
      `${G1_BASE_URL}/reviews/g1-fixture-review/versions/g1-version-1`,
    ]);
    expect("text" in feed.body && atomEntryIds(feed.body.text)).toEqual(feed.atomEntryIds);
    expect("text" in feed.body && feed.body.text).not.toContain("unpublished draft");
  });

  it("matches the checked-in OpenAPI artifacts and keeps the existing public caching", () => {
    const yaml = readFileSync(resolve(process.cwd(), "docs/openapi.yaml"));
    const yamlSha = createHash("sha256").update(yaml).digest("hex");
    expect(route("openapi-yaml").body).toEqual({ sha256: yamlSha, length: yaml.byteLength });
    const artifacts = readFileSync(
      resolve(process.cwd(), "apps/web/src/generated/openapi-artifacts.ts"),
      "utf8",
    );
    for (const id of ["openapi-yaml", "openapi-json"]) {
      const headers = Object.fromEntries(route(id).headers);
      expect(headers["cache-control"]).toBe("public, max-age=300, s-maxage=3600");
      expect(artifacts).toContain(JSON.stringify(headers.etag));
      expect(Object.fromEntries(route(`${id}-304`).headers).etag).toBe(headers.etag);
      expect(route(`${id}-304`).requestHeaders).toEqual({ "if-none-match": headers.etag });
      expect(route(`${id}-304`).status).toBe(304);
    }
  });
});
