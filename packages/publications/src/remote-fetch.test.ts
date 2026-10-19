import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createHardenedRemoteFetcher,
  RemoteFetchError,
  isPublicNetworkAddress,
} from "./remote-fetch.js";

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

describe("public-network address classification", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "140.82.112.3",
    // Neighbours just outside blocked ranges are public.
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "100.128.0.1",
    "192.0.1.1",
    "198.17.255.255",
    "198.20.0.1",
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "2a00:1450:4001::1",
    // 2001:200::/23 is allocated public space just above the blocked 2001::/23.
    "2001:200::1",
  ])("accepts the public address %s", (address) => {
    expect(isPublicNetworkAddress(address)).toBe(true);
  });

  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.100.100.200",
    "100.127.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    // IPv4-mapped answers are refused outright, including a mapped public IPv4.
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "64:ff9b::7f00:1",
    "100::1",
    "2001::1",
    "2001:1ff::1",
    "2001:db8::1",
    "fc00::1",
    "fd00:ec2::254",
    "fe80::1",
    "ff02::1",
  ])("refuses the non-public address %s", (address) => {
    expect(isPublicNetworkAddress(address)).toBe(false);
  });

  it("refuses values that are not IP literals", () => {
    for (const value of ["", "example.org", "999.1.1.1", "1.1.1", "8.8.8.8/24"]) {
      expect(isPublicNetworkAddress(value)).toBe(false);
    }
  });
});

describe("hostile destinations are refused before any connection", () => {
  const request = { maxBytes: 100, acceptedMediaTypes: ["application/json"] };
  // Any hostname that reaches DNS resolves to a private address, so no case
  // here can open a socket; each outcome is decided before connecting.
  const privateResolver = async () => [{ address: "10.0.0.5", family: 4 as const }];

  it.each([
    ["https://127.0.0.1/m.json", "unsafe-destination"],
    ["https://2130706433/m.json", "unsafe-destination"],
    ["https://0x7f.1/m.json", "unsafe-destination"],
    ["https://0177.0.0.1/m.json", "unsafe-destination"],
    ["https://[::1]/m.json", "unsafe-destination"],
    ["https://[::ffff:7f00:1]/m.json", "unsafe-destination"],
    ["https://[::ffff:127.0.0.1]/m.json", "unsafe-destination"],
    ["https://169.254.169.254/latest/meta-data", "unsafe-destination"],
    ["https://[fd00:ec2::254]/", "unsafe-destination"],
    ["https://localhost/m.json", "unsafe-destination"],
    ["https://localhost./m.json", "unsafe-destination"],
    ["https://LOCALHOST/m.json", "unsafe-destination"],
    ["https://foo.localhost/m.json", "unsafe-destination"],
    ["https://metadata.google.internal/", "unsafe-destination"],
    ["https://intranet/m.json", "unsafe-destination"],
    ["https://printer.local/m.json", "unsafe-destination"],
    ["https://service.corp/m.json", "unsafe-destination"],
    ["https://user:pw@example.org/m.json", "unsafe-url"],
    ["https://example.org/m.json#fragment", "unsafe-url"],
    ["https://example.org:8443/m.json", "unsafe-url"],
    ["http://example.org/m.json", "unsafe-url"],
    ["ftp://example.org/m.json", "unsafe-url"],
    ["file:///etc/passwd", "unsafe-url"],
    ["not a url", "unsafe-url"],
  ])("refuses %s with %s", async (url, code) => {
    const fetcher = createHardenedRemoteFetcher({
      resolver: privateResolver,
      connectTimeoutMs: 400,
      readTimeoutMs: 400,
    });
    await expect(fetcher.fetch(url, request)).rejects.toMatchObject({ code });
  });

  it.each([
    [["93.184.216.34", "10.0.0.5"]],
    [["10.0.0.5", "93.184.216.34"]],
    [["2606:4700:4700::1111", "fc00::1"]],
  ])("refuses a DNS answer set mixing public and private addresses %j", async (answers) => {
    const fetcher = createHardenedRemoteFetcher({
      resolver: async () =>
        answers.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
      connectTimeoutMs: 400,
      readTimeoutMs: 400,
    });
    await expect(
      fetcher.fetch("https://publication.example/m.json", request),
    ).rejects.toMatchObject({ code: "unsafe-destination" });
  });
});
