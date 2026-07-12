import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "./content-security-policy.js";

describe("buildContentSecurityPolicy", () => {
  it("requires a nonce and forbids unsafe inline scripts in production", () => {
    const policy = buildContentSecurityPolicy("abc123", false);
    const scriptDirective = policy.split("; ").find((part) => part.startsWith("script-src"));

    expect(scriptDirective).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(scriptDirective).not.toContain("'unsafe-inline'");
    expect(scriptDirective).not.toContain("'unsafe-eval'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("allows only the development capabilities required by HMR", () => {
    const policy = buildContentSecurityPolicy("dev123", true);

    expect(policy).toContain("'nonce-dev123'");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws: wss:");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
