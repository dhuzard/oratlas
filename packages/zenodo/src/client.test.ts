import { describe, expect, it, vi } from "vitest";
import { createFetchResolver } from "./client.js";

describe("createFetchResolver security boundaries", () => {
  it.each([
    "http://zenodo.org/api",
    "https://zenodo.org.evil.example/api",
    "https://user:pass@zenodo.org/api",
    "https://zenodo.org:444/api",
    "https://127.0.0.1/api",
    "https://zenodo.org/api/other",
  ])("rejects a non-canonical Zenodo API base before fetching: %s", (zenodoApiBase) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => createFetchResolver({ zenodoApiBase, fetchImpl })).toThrow(/canonical/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses fail-closed redirect handling for DOI and Zenodo requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      return url.startsWith("https://doi.org/")
        ? new Response(null, { status: 302, headers: { location: "https://zenodo.org/records/1" } })
        : new Response('{"id":1,"metadata":{}}', { status: 200 });
    });
    const resolver = createFetchResolver({ fetchImpl });
    await resolver.resolveDoi("10.5281/zenodo.1");
    await resolver.fetchZenodoRecord("1");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![1]?.redirect).toBe("manual");
    expect(fetchImpl.mock.calls[1]![1]?.redirect).toBe("error");
  });

  it.each([
    "http://example.org/record/1",
    "https://user:pass@example.org/record/1",
    "https://localhost/record/1",
    "https://localhost./record/1",
    "https://service.local/record/1",
    "https://service.local./record/1",
    "https://127.0.0.1/record/1",
    "https://10.0.0.1/record/1",
    "https://169.254.169.254/latest/meta-data",
    "https://192.168.1.1/record/1",
    "https://[::1]/record/1",
    "https://[fd00::1]/record/1",
  ])("omits an unsafe DOI resolution Location: %s", async (location) => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 302, headers: { location } }),
    );
    const result = await createFetchResolver({ fetchImpl }).resolveDoi("10.1234/example");

    expect(result.resolves).toBe(true);
    expect(result.resolvedUrl).toBeUndefined();
  });

  it("retains a bounded public HTTPS DOI resolution Location", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://zenodo.org/records/123?version=1" },
        }),
    );
    const result = await createFetchResolver({ fetchImpl }).resolveDoi("10.5281/zenodo.123");

    expect(result.resolvedUrl).toBe("https://zenodo.org/records/123?version=1");
  });

  it("omits an overlong DOI resolution Location", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: `https://example.org/${"a".repeat(2048)}` },
        }),
    );
    const result = await createFetchResolver({ fetchImpl }).resolveDoi("10.1234/example");

    expect(result.resolvedUrl).toBeUndefined();
  });

  it("rejects an oversized declared metadata response before reading its body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(body, { status: 200, headers: { "content-length": "101" } }),
    );
    const record = await createFetchResolver({
      fetchImpl,
      maxResponseBytes: 100,
    }).fetchZenodoRecord("1");

    expect(record).toBeNull();
    expect(cancelled).toBe(true);
  });

  it("cancels an unknown-length metadata stream after the cap is exceeded", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(60));
        controller.enqueue(new Uint8Array(60));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
    const record = await createFetchResolver({
      fetchImpl,
      maxResponseBytes: 100,
    }).fetchZenodoRecord("1");

    expect(record).toBeNull();
    expect(cancelled).toBe(true);
  });

  it("discovers the newest Zenodo record by an exact GitHub repository relation", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            hits: {
              hits: [
                {
                  id: 21549715,
                  doi: "10.5281/zenodo.21549715",
                  conceptrecid: "21549714",
                  conceptdoi: "10.5281/zenodo.21549714",
                  metadata: {
                    title: "The Ethical Debt",
                    version: "0.1.0-rc.2",
                    related_identifiers: [
                      {
                        identifier: "https://github.com/dhuzard/ethical-debt-AI-review",
                        relation: "isSupplementTo",
                      },
                    ],
                  },
                },
              ],
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const record = await createFetchResolver({ fetchImpl }).findZenodoRecordByRepositoryUrl(
      "https://github.com/dhuzard/ethical-debt-AI-review/",
    );

    expect(record).toMatchObject({
      recordId: "21549715",
      doi: "10.5281/zenodo.21549715",
      conceptRecordId: "21549714",
      conceptDoi: "10.5281/zenodo.21549714",
      versionTag: "0.1.0-rc.2",
    });
    const requested = new URL(String(fetchImpl.mock.calls[0]![0]));
    expect(requested.origin + requested.pathname).toBe("https://zenodo.org/api/records");
    expect(requested.searchParams.get("q")).toBe(
      'metadata.related_identifiers.identifier:"https://github.com/dhuzard/ethical-debt-AI-review"',
    );
    expect(fetchImpl.mock.calls[0]![1]?.redirect).toBe("error");
  });

  it("rejects invalid repository URLs and search false positives", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            hits: {
              hits: [
                {
                  id: 1,
                  doi: "10.5281/zenodo.1",
                  metadata: {
                    related_identifiers: [
                      {
                        identifier: "https://github.com/other/project",
                        relation: "isSupplementTo",
                      },
                    ],
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
    );
    const resolver = createFetchResolver({ fetchImpl });

    await expect(
      resolver.findZenodoRecordByRepositoryUrl("https://github.com/owner/repo/issues"),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(
      resolver.findZenodoRecordByRepositoryUrl("https://github.com/owner/repo"),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
