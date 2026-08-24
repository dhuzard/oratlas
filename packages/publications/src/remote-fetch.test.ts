import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHardenedRemoteFetcher, RemoteFetchError } from "./remote-fetch.js";

let server: Server;
let port: number;

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    if (path === "/oversized") {
      response.writeHead(200, { "content-type": "application/json", "content-length": "9999" });
      response.end("{}");
      return;
    }
    if (path.startsWith("/redirect/")) {
      const index = Number(path.split("/").at(-1));
      response.writeHead(302, { location: `/redirect/${index + 1}` });
      response.end();
      return;
    }
    if (path === "/redirect-localhost") {
      response.writeHead(302, { location: `http://localhost:${port}/ok` });
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

function fixtureFetcher(maxRedirects = 2) {
  return createHardenedRemoteFetcher({
    maxRedirects,
    allowHttpForTests: true,
    allowPrivateAddressesForTests: true,
    allowNonDefaultPortsForTests: true,
    resolver: async () => [{ address: "127.0.0.1", family: 4 }],
  });
}

describe("hardened external publication fetch", () => {
  it("rejects HTTP outside the explicit test fixture policy", async () => {
    await expect(
      createHardenedRemoteFetcher().fetch("http://example.org/manifest.json", {
        maxBytes: 100,
        acceptedMediaTypes: ["application/json"],
      }),
    ).rejects.toMatchObject({ code: "unsafe-url" });
  });

  it("rejects DNS answers in private and metadata-address ranges", async () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "::1", "fc00::1"]) {
      const fetcher = createHardenedRemoteFetcher({
        resolver: async () => [{ address, family: address.includes(":") ? 6 : 4 }],
      });
      await expect(
        fetcher.fetch("https://publication.example/manifest.json", {
          maxBytes: 100,
          acceptedMediaTypes: ["application/json"],
        }),
      ).rejects.toMatchObject({ code: "unsafe-destination" });
    }
  });

  it("enforces the actual response-byte bound", async () => {
    await expect(
      fixtureFetcher().fetch(`http://fixture.test:${port}/oversized`, {
        maxBytes: 10,
        acceptedMediaTypes: ["application/json"],
      }),
    ).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("limits redirects and validates every redirect destination", async () => {
    await expect(
      fixtureFetcher(1).fetch(`http://fixture.test:${port}/redirect/0`, {
        maxBytes: 100,
        acceptedMediaTypes: ["application/json"],
      }),
    ).rejects.toMatchObject({ code: "redirect-limit" });

    await expect(
      fixtureFetcher().fetch(`http://fixture.test:${port}/redirect-localhost`, {
        maxBytes: 100,
        acceptedMediaTypes: ["application/json"],
      }),
    ).rejects.toBeInstanceOf(RemoteFetchError);
    await expect(
      fixtureFetcher().fetch(`http://fixture.test:${port}/redirect-localhost`, {
        maxBytes: 100,
        acceptedMediaTypes: ["application/json"],
      }),
    ).rejects.toMatchObject({ code: "unsafe-destination" });
  });
});
