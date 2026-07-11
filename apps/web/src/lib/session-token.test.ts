import { describe, expect, it } from "vitest";
import { createSessionToken, readSessionToken, SESSION_MAX_AGE_SECONDS } from "./session-token.js";

describe("signed session tokens", () => {
  const secret = "test-secret-with-enough-entropy";
  const issuedAt = Date.UTC(2026, 6, 1);

  it("accepts an authentic token within its server-side lifetime", () => {
    const token = createSessionToken("user-1", secret, issuedAt);
    expect(readSessionToken(token, secret, issuedAt + 1_000)).toBe("user-1");
  });

  it("rejects an authentic token after the configured lifetime", () => {
    const token = createSessionToken("user-1", secret, issuedAt);
    const expiredAt = issuedAt + SESSION_MAX_AGE_SECONDS * 1_000 + 1;
    expect(readSessionToken(token, secret, expiredAt)).toBeNull();
  });

  it("rejects future-issued and tampered tokens", () => {
    const token = createSessionToken("user-1", secret, issuedAt);
    expect(readSessionToken(token, secret, issuedAt - 1)).toBeNull();
    expect(readSessionToken(token.replace("user-1", "admin-1"), secret, issuedAt)).toBeNull();
  });
});
