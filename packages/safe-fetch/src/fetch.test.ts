import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { OperationBudget, SafeFetchError, safeFetch, type LookupFunction } from "./fetch.js";
import { FIXTURE_URL_SAFETY_POLICY, startFixtureSite, type FixtureSite } from "./testing.js";

/**
 * Adversarial behaviour of the outbound boundary, against a real local server.
 * Nothing here touches the public internet.
 */

let site: FixtureSite | undefined;

afterEach(async () => {
  await site?.close();
  site = undefined;
});

async function expectFailure(promise: Promise<unknown>): Promise<SafeFetchError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SafeFetchError);
    return error as SafeFetchError;
  }
  throw new Error("Expected the fetch to fail.");
}

describe("safeFetch", () => {
  it("returns the exact bytes, their digest and the final URL", async () => {
    const body = '{"schemaVersion":"0.2.0"}';
    site = await startFixtureSite({ "/oratlas.manifest.json": { body } });

    const response = await safeFetch(site.url("/oratlas.manifest.json"), {
      policy: FIXTURE_URL_SAFETY_POLICY,
    });

    expect(response.status).toBe(200);
    expect(response.bytes.toString("utf8")).toBe(body);
    expect(response.sha256).toBe(createHash("sha256").update(body, "utf8").digest("hex"));
    expect(response.byteLength).toBe(Buffer.byteLength(body));
    expect(response.mediaType).toBe("application/json");
    expect(response.finalUrl).toBe(site.url("/oratlas.manifest.json"));
    expect(response.redirects).toEqual([]);
  });

  it("refuses a loopback destination unless the caller opted in", async () => {
    site = await startFixtureSite({ "/oratlas.manifest.json": { body: "{}" } });
    const failure = await expectFailure(safeFetch(site.url("/oratlas.manifest.json")));
    expect(failure.code).toBe("url-scheme-not-allowed");

    const overHttps = await expectFailure(
      safeFetch("https://127.0.0.1/oratlas.manifest.json", { policy: {} }),
    );
    expect(overHttps.code).toBe("url-host-not-allowed");
  });

  it("follows a bounded redirect chain and records every hop", async () => {
    site = await startFixtureSite({
      "/a": { redirectTo: "/b" },
      "/b": { redirectTo: "/c", redirectStatus: 301 },
      "/c": { body: "final" },
    });

    const response = await safeFetch(site.url("/a"), {
      policy: FIXTURE_URL_SAFETY_POLICY,
      maxRedirects: 3,
    });

    expect(response.bytes.toString("utf8")).toBe("final");
    expect(response.requestedUrl).toBe(site.url("/a"));
    expect(response.finalUrl).toBe(site.url("/c"));
    expect(response.redirects.map((hop) => hop.to)).toEqual([site.url("/b"), site.url("/c")]);
  });

  it("stops at the redirect cap", async () => {
    site = await startFixtureSite({
      "/0": { redirectTo: "/1" },
      "/1": { redirectTo: "/2" },
      "/2": { redirectTo: "/3" },
      "/3": { body: "final" },
    });

    const failure = await expectFailure(
      safeFetch(site.url("/0"), { policy: FIXTURE_URL_SAFETY_POLICY, maxRedirects: 2 }),
    );
    expect(failure.code).toBe("too-many-redirects");
  });

  it("re-admits every redirect target, so a public URL cannot reach a metadata address", async () => {
    site = await startFixtureSite({
      "/manifest": { redirectTo: "http://169.254.169.254/latest/meta-data/iam/" },
      "/to-private": { redirectTo: "http://10.0.0.1/internal" },
    });

    for (const path of ["/manifest", "/to-private"]) {
      const failure = await expectFailure(
        // Even the fully relaxed fixture policy must not admit these hops.
        safeFetch(site.url(path), {
          policy: { ...FIXTURE_URL_SAFETY_POLICY, allowPrivateNetworks: false },
        }),
      );
      expect(failure.code).toBe("redirect-not-allowed");
    }
  });

  it("refuses a redirect that leaves the allowed scheme", async () => {
    site = await startFixtureSite({ "/manifest": { redirectTo: "file:///etc/passwd" } });
    const failure = await expectFailure(
      safeFetch(site.url("/manifest"), {
        policy: { allowLoopback: true, allowNonStandardPorts: true, allowInsecureHttp: true },
      }),
    );
    expect(failure.code).toBe("redirect-not-allowed");
  });

  it("rejects an oversized body, both declared and streamed", async () => {
    const big = "x".repeat(4_096);
    site = await startFixtureSite({
      "/declared": { body: big, declaredContentLength: 4_096 },
      "/streamed": { body: big, headers: { "transfer-encoding": "chunked" } },
    });

    const declared = await expectFailure(
      safeFetch(site.url("/declared"), {
        policy: FIXTURE_URL_SAFETY_POLICY,
        maxResponseBytes: 1_024,
      }),
    );
    expect(declared.code).toBe("response-too-large");

    const streamed = await expectFailure(
      safeFetch(site.url("/streamed"), {
        policy: FIXTURE_URL_SAFETY_POLICY,
        maxResponseBytes: 1_024,
      }),
    );
    expect(streamed.code).toBe("response-too-large");
  });

  it("enforces content-type sanity fail-closed", async () => {
    site = await startFixtureSite({
      "/html": { body: "<script>alert(1)</script>", headers: { "content-type": "text/html" } },
      "/none": { body: "{}", headers: { "content-type": "" } },
    });

    const html = await expectFailure(
      safeFetch(site.url("/html"), {
        policy: FIXTURE_URL_SAFETY_POLICY,
        allowedMediaTypes: ["application/json"],
      }),
    );
    expect(html.code).toBe("content-type-not-allowed");

    const none = await expectFailure(
      safeFetch(site.url("/none"), {
        policy: FIXTURE_URL_SAFETY_POLICY,
        allowedMediaTypes: ["application/json"],
      }),
    );
    expect(none.code).toBe("content-type-not-allowed");
  });

  it("surfaces a non-2xx status without leaking the body", async () => {
    site = await startFixtureSite({ "/missing": { status: 404, body: "nope" } });
    const failure = await expectFailure(
      safeFetch(site.url("/missing"), { policy: FIXTURE_URL_SAFETY_POLICY }),
    );
    expect(failure.code).toBe("http-status");
    expect(failure.message).not.toContain("nope");
  });

  it("rejects a host that resolves to a private address, however it looks by name", async () => {
    // The name passes every syntactic check; only the resolver's answer betrays
    // it. This is the DNS-rebinding shape: classification happens at connect.
    const hostileLookup: LookupFunction = (_hostname, options, callback) => {
      const entries = [{ address: "10.1.2.3", family: 4 }];
      if (options.all === true) callback(null, entries);
      else callback(null, entries[0]!.address, 4);
    };

    const failure = await expectFailure(
      safeFetch("https://lab.example.org/oratlas.manifest.json", { lookup: hostileLookup }),
    );
    expect(failure.code).toBe("destination-not-public");
  });

  it("rejects a resolver answer that mixes a public and a private address", async () => {
    const mixedLookup: LookupFunction = (_hostname, options, callback) => {
      const entries = [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ];
      if (options.all === true) callback(null, entries);
      else callback(null, entries[0]!.address, 4);
    };

    const failure = await expectFailure(
      safeFetch("https://lab.example.org/oratlas.manifest.json", { lookup: mixedLookup }),
    );
    expect(failure.code).toBe("destination-not-public");
  });

  it("abandons a slow destination when the operation budget is spent", async () => {
    site = await startFixtureSite({ "/slow": { body: "{}", delayMs: 2_000 } });
    const failure = await expectFailure(
      safeFetch(site.url("/slow"), {
        policy: FIXTURE_URL_SAFETY_POLICY,
        budget: new OperationBudget(150),
        connectTimeoutMs: 150,
      }),
    );
    expect(failure.code).toBe("timeout");
  });

  it("refuses to start once the shared budget is already spent", async () => {
    site = await startFixtureSite({ "/manifest": { body: "{}" } });
    const budget = new OperationBudget(-1);
    const failure = await expectFailure(
      safeFetch(site.url("/manifest"), { policy: FIXTURE_URL_SAFETY_POLICY, budget }),
    );
    expect(failure.code).toBe("timeout");
  });
});
