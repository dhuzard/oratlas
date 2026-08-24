import { describe, expect, it } from "vitest";
import { assertSafeOraDemoBaseUrl } from "./ora-demo-target";

describe("deterministic ORA demo target safety", () => {
  it.each([
    "http://localhost:3000",
    "https://demo.localhost",
    "http://127.0.0.1:3000",
    "http://127.0.0.2",
    "http://[::1]:3000",
  ])("accepts a local origin: %s", (url) => {
    expect(assertSafeOraDemoBaseUrl(url, false)).toBe(new URL(url).origin);
  });

  it("default-denies a remote deployment and requires an explicit override", () => {
    expect(() => assertSafeOraDemoBaseUrl("https://atlas.example", false)).toThrow(
      /refuses remote targets/,
    );
    expect(assertSafeOraDemoBaseUrl("https://isolated-demo.example", true)).toBe(
      "https://isolated-demo.example",
    );
  });

  it.each([
    "not a URL",
    "file:///tmp/demo",
    "https://atlas.example/production",
    "https://u:p@localhost",
  ])("rejects a non-origin target: %s", (url) =>
    expect(() => assertSafeOraDemoBaseUrl(url, true)).toThrow(/must be an HTTP\(S\) origin/),
  );
});
