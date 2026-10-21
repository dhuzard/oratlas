import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { openApiResponse } from "../openapi-response";
import {
  mergeVary,
  PRIVATE_CACHE_CONTROL,
  privateResponse,
  PrivateResponseError,
} from "./cache-control";

vi.mock("server-only", () => ({}));

// Synthetic handlers only: no production endpoint uses the helper. This exercises the response
// composition boundary, not workspace authorization or CDN/Next deployment caching.
type Principal = "principal-a" | "principal-b" | undefined;

function principalOf(request: Request): Principal {
  const cookie = request.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)g1_session=(principal-[ab])(?:;|$)/u.exec(cookie);
  return match?.[1] as Principal;
}

/**
 * A deliberately naive handler that would emit content validators and honor conditionals the way
 * the public OpenAPI route does. The private pipeline must neutralize the first and refuse the
 * second.
 */
function naiveHandler(request: Request): Response {
  const principal = principalOf(request);
  if (!principal) {
    return Response.json({ error: { code: "not-found", message: "Not found" } }, { status: 404 });
  }
  if (new URL(request.url).searchParams.has("fail")) {
    return Response.json({ error: { code: "internal-error", message: "Failed" } }, { status: 500 });
  }
  const body = JSON.stringify({ principal, items: [`${principal}-item`] });
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600",
      ETag: etag,
      "Last-Modified": "Wed, 01 Apr 2026 00:00:00 GMT",
      Vary: "Accept-Encoding",
    },
  });
}

/** The private pipeline: never forward conditional headers, always compose privately. */
function privatePipeline(request: Request): Response {
  const headers = new Headers(request.headers);
  headers.delete("if-none-match");
  headers.delete("if-modified-since");
  return privateResponse(naiveHandler(new Request(request.url, { headers })));
}

const request = (principal?: Principal, init: HeadersInit = {}, query = "") => {
  const headers = new Headers(init);
  if (principal) headers.set("cookie", `theme=dark; g1_session=${principal}`);
  return new Request(`https://g1.oratlas.example/api/private/fixture${query}`, { headers });
};

function expectPrivateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe(PRIVATE_CACHE_CONTROL);
  expect(response.headers.get("vary")?.toLowerCase().split(", ")).toContain("cookie");
  expect(response.headers.get("etag")).toBeNull();
  expect(response.headers.get("last-modified")).toBeNull();
}

describe("private, no-store response composition (G1 fixture, not authorization)", () => {
  it("preserves a success response's status and body while making it private", async () => {
    const response = privatePipeline(request("principal-a"));
    expect(response.status).toBe(200);
    expectPrivateHeaders(response);
    expect(response.headers.get("vary")).toBe("Accept-Encoding, Cookie");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({
      principal: "principal-a",
      items: ["principal-a-item"],
    });
  });

  it("applies the same headers to error and generic not-found responses", async () => {
    const failure = privatePipeline(request("principal-a", {}, "?fail=1"));
    expect(failure.status).toBe(500);
    expectPrivateHeaders(failure);
    expect(await failure.json()).toEqual({ error: { code: "internal-error", message: "Failed" } });

    const denied = privatePipeline(request(undefined));
    expect(denied.status).toBe(404);
    expectPrivateHeaders(denied);
    expect(await denied.json()).toEqual({ error: { code: "not-found", message: "Not found" } });
  });

  it("answers a conditional request with the normal full body, never 304", async () => {
    const first = naiveHandler(request("principal-a"));
    const etag = first.headers.get("etag")!;
    const conditional = privatePipeline(
      request("principal-a", {
        "If-None-Match": etag,
        "If-Modified-Since": "Wed, 01 Apr 2026 00:00:00 GMT",
      }),
    );
    expect(conditional.status).toBe(200);
    expectPrivateHeaders(conditional);
    expect((await conditional.json()).principal).toBe("principal-a");
  });

  it("refuses to compose a 304 instead of turning a body-less 304 into a fake 200", () => {
    const etag = naiveHandler(request("principal-a")).headers.get("etag")!;
    const notModified = naiveHandler(request("principal-a", { "If-None-Match": etag }));
    expect(notModified.status).toBe(304);
    expect(() => privateResponse(notModified)).toThrow(PrivateResponseError);
  });

  it("gives two principals their own bodies with nothing a shared cache could reuse", async () => {
    const a = privatePipeline(request("principal-a"));
    const b = privatePipeline(request("principal-b"));
    expectPrivateHeaders(a);
    expectPrivateHeaders(b);
    expect((await a.json()).principal).toBe("principal-a");
    expect((await b.json()).principal).toBe("principal-b");
  });

  it("preserves status text and stream bodies and replaces any caller Cache-Control", async () => {
    const response = privateResponse(
      new Response(new Blob(["streamed"]).stream(), {
        status: 202,
        statusText: "Accepted",
        headers: { "Cache-Control": "public, s-maxage=3600", "X-Custom": "kept" },
      }),
    );
    expect(response.status).toBe(202);
    expect(response.statusText).toBe("Accepted");
    expect(response.headers.get("cache-control")).toBe(PRIVATE_CACHE_CONTROL);
    expect(response.headers.get("x-custom")).toBe("kept");
    expect(await response.text()).toBe("streamed");
  });

  it.each([
    [null, "Cookie"],
    ["", "Cookie"],
    ["Accept-Encoding", "Accept-Encoding, Cookie"],
    ["cookie", "cookie"],
    ["Accept-Encoding, COOKIE", "Accept-Encoding, COOKIE"],
    ["Origin,  Accept-Encoding ,origin", "Origin, Accept-Encoding, Cookie"],
    ["*", "*"],
    ["Accept-Encoding, *", "Accept-Encoding, *"],
  ])("merges Vary %j into %j", (existing, expected) => {
    expect(mergeVary(existing, "Cookie")).toBe(expected);
  });

  it("merges multiple Vary header lines without duplicating Cookie", () => {
    const headers = new Headers();
    headers.append("Vary", "Accept-Encoding");
    headers.append("Vary", "Cookie");
    const response = privateResponse(new Response("x", { headers }));
    expect(response.headers.get("vary")).toBe("Accept-Encoding, Cookie");
  });

  it("leaves the public OpenAPI caching and 304 behaviour unchanged", () => {
    const response = openApiResponse(
      new Request("https://g1.oratlas.example/openapi.yaml"),
      "yaml",
    );
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=3600");
    const etag = response.headers.get("etag")!;
    expect(etag).toMatch(/^"sha256-/u);
    const conditional = openApiResponse(
      new Request("https://g1.oratlas.example/openapi.yaml", {
        headers: { "If-None-Match": etag },
      }),
      "yaml",
    );
    expect(conditional.status).toBe(304);
  });
});
