import { describe, expect, it } from "vitest";
import { classifyIpAddress, isIpLiteral } from "./address.js";
import { assessExternalUrl } from "./url-safety.js";

/** Every URL and address here is treated as attacker-chosen. */

describe("address classification", () => {
  it("recognises loopback, private, link-local and metadata destinations", () => {
    expect(classifyIpAddress("127.0.0.1")).toBe("loopback");
    expect(classifyIpAddress("127.9.9.9")).toBe("loopback");
    expect(classifyIpAddress("10.1.2.3")).toBe("private");
    expect(classifyIpAddress("172.16.0.1")).toBe("private");
    expect(classifyIpAddress("172.32.0.1")).toBe("public");
    expect(classifyIpAddress("192.168.1.1")).toBe("private");
    expect(classifyIpAddress("100.64.0.1")).toBe("private");
    expect(classifyIpAddress("169.254.1.1")).toBe("link-local");
    expect(classifyIpAddress("169.254.169.254")).toBe("cloud-metadata");
    expect(classifyIpAddress("100.100.100.200")).toBe("cloud-metadata");
    expect(classifyIpAddress("0.0.0.0")).toBe("unspecified");
    expect(classifyIpAddress("224.0.0.1")).toBe("multicast");
    expect(classifyIpAddress("255.255.255.255")).toBe("reserved");
    expect(classifyIpAddress("93.184.216.34")).toBe("public");
  });

  it("classifies IPv6 including mapped and unique-local forms", () => {
    expect(classifyIpAddress("::1")).toBe("loopback");
    expect(classifyIpAddress("[::1]")).toBe("loopback");
    expect(classifyIpAddress("::")).toBe("unspecified");
    expect(classifyIpAddress("fd00::1")).toBe("private");
    expect(classifyIpAddress("fe80::1")).toBe("link-local");
    expect(classifyIpAddress("fe80::1%eth0")).toBe("link-local");
    expect(classifyIpAddress("ff02::1")).toBe("multicast");
    expect(classifyIpAddress("fd00:ec2::254")).toBe("cloud-metadata");
    // An IPv4-mapped private address must not become public by wearing IPv6.
    expect(classifyIpAddress("::ffff:10.0.0.1")).toBe("private");
    expect(classifyIpAddress("::ffff:127.0.0.1")).toBe("loopback");
    expect(classifyIpAddress("2606:4700:4700::1111")).toBe("public");
  });

  it("does not treat a hostname as an address", () => {
    expect(classifyIpAddress("lab.example.org")).toBeNull();
    expect(isIpLiteral("lab.example.org")).toBe(false);
    // Zero-padded octets are read differently by different resolvers, so they
    // are not accepted as an address at all.
    expect(classifyIpAddress("010.0.0.1")).toBeNull();
  });
});

describe("URL admission under the production policy", () => {
  const reject = (url: string) => {
    const result = assessExternalUrl(url);
    expect(result.ok, `expected ${url} to be rejected`).toBe(false);
    return result as Extract<typeof result, { ok: false }>;
  };

  it("accepts an ordinary https publication URL", () => {
    const result = assessExternalUrl("https://lab.example.org/review/oratlas.manifest.json");
    expect(result.ok).toBe(true);
  });

  it("refuses plaintext http", () => {
    expect(reject("http://lab.example.org/oratlas.manifest.json").code).toBe(
      "url-scheme-not-allowed",
    );
  });

  it("refuses non-http schemes outright", () => {
    expect(reject("file:///etc/passwd").code).toBe("url-scheme-not-allowed");
    expect(reject("gopher://lab.example.org/").code).toBe("url-scheme-not-allowed");
    expect(reject("data:application/json,{}").code).toBe("url-scheme-not-allowed");
  });

  it("refuses embedded credentials", () => {
    expect(reject("https://user:secret@lab.example.org/m.json").code).toBe(
      "url-credentials-not-allowed",
    );
  });

  it("refuses non-standard ports", () => {
    expect(reject("https://lab.example.org:8443/m.json").code).toBe("url-port-not-allowed");
    expect(assessExternalUrl("https://lab.example.org:443/m.json").ok).toBe(true);
  });

  it("refuses loopback, private, link-local and metadata literals", () => {
    for (const host of [
      "127.0.0.1",
      "[::1]",
      "10.0.0.5",
      "192.168.0.5",
      "169.254.169.254",
      "[fd00::1]",
      "0.0.0.0",
    ]) {
      expect(reject(`https://${host}/oratlas.manifest.json`).code).toBe("url-host-not-allowed");
    }
  });

  it("refuses internal DNS destinations by name", () => {
    for (const host of [
      "localhost",
      "app.localhost",
      "printer.local",
      "vault.internal",
      "metadata.google.internal",
      "instance-data",
      "wiki.corp",
      "intranet",
      "db.home.arpa",
    ]) {
      expect(reject(`https://${host}/oratlas.manifest.json`).code).toBe("url-host-not-allowed");
    }
  });

  it("refuses a URL longer than the cap and an unparseable URL", () => {
    expect(reject(`https://lab.example.org/${"a".repeat(2_100)}`).code).toBe("url-too-long");
    expect(reject("not a url").code).toBe("url-malformed");
  });

  it("only relaxes when a caller explicitly opts in", () => {
    const fixturePolicy = {
      allowInsecureHttp: true,
      allowLoopback: true,
      allowNonStandardPorts: true,
    };
    expect(
      assessExternalUrl("http://127.0.0.1:45123/oratlas.manifest.json", fixturePolicy).ok,
    ).toBe(true);
    // Even a fully relaxed fixture policy never admits a metadata address.
    const metadata = assessExternalUrl("http://169.254.169.254/latest/meta-data", {
      ...fixturePolicy,
      allowPrivateNetworks: true,
    });
    expect(metadata.ok).toBe(false);
  });
});
