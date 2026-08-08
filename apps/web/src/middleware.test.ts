import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware.js";

vi.mock("server-only", () => ({}));

describe("CSP middleware", () => {
  it("binds the same fresh nonce to the request and response policy", () => {
    const request = new NextRequest("https://oratlas.example/reviews/example");
    const response = middleware(request);
    const policy = response.headers.get("content-security-policy");
    const nonce = policy?.match(/'nonce-([a-f0-9]{32})'/)?.[1];

    expect(nonce).toBeTruthy();
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
  });

  it("advertises service documentation on public discovery pages", () => {
    const response = middleware(new NextRequest("https://oratlas.example/api-docs"));
    expect(response.headers.get("link")).toContain('rel="service-desc"');
    expect(response.headers.get("link")).toContain('rel="service-doc"');
  });
});
