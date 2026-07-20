import { describe, expect, it, vi } from "vitest";
import { createFetchTransport } from "./transport.js";

describe("createFetchTransport security boundaries", () => {
  it.each([
    "http://api.github.com",
    "https://api.github.com.evil.example",
    "https://user:pass@api.github.com",
    "https://api.github.com:444",
    "https://127.0.0.1",
    "https://api.github.com/repos",
  ])("rejects a non-canonical API base before fetching: %s", (baseUrl) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => createFetchTransport({ baseUrl, fetchImpl, token: "secret" })).toThrow(
      /canonical/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps test injection on the trusted origin and never follows redirects", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
    );
    const transport = createFetchTransport({ fetchImpl, token: "secret" });
    await transport.request("/repos/owner/repo");

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.github.com/repos/owner/repo");
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer secret");
  });

  it("rejects an oversized declared response before reading its body", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("never read"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(body, { status: 200, headers: { "content-length": "101" } }),
    );
    const response = await createFetchTransport({ fetchImpl, maxResponseBytes: 100 }).request("/x");

    expect(response.ok).toBe(false);
    expect(response.status).toBe(0);
    expect(response.json).toMatchObject({ message: expect.stringContaining("100-byte limit") });
    expect(cancelled).toBe(true);
  });

  it("cancels an unknown-length stream once its decoded bytes exceed the cap", async () => {
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
    const response = await createFetchTransport({ fetchImpl, maxResponseBytes: 100 }).request("/x");

    expect(response.ok).toBe(false);
    expect(cancelled).toBe(true);
  });
});
