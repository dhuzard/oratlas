import { describe, expect, it } from "vitest";
import { createSessionToken, readSessionToken, SESSION_MAX_AGE_SECONDS } from "./session-token";
import {
  createSessionInstanceToken,
  sessionInstanceSchema,
  validateSessionInstanceToken,
} from "./session-instance";

const secret = "synthetic-session-secret";
const now = 1_000;
const row = {
  id: "synthetic_instance_00000000000001",
  principalId: "synthetic-user",
  authzEpochAtIssue: 3,
  issuedAtMs: now,
  expiresAtMs: now + 60_000,
  revokedAtMs: null,
};
const principal = { id: row.principalId, authzEpoch: 3, disabled: false };
const token = createSessionInstanceToken(row, secret);
const read = (value: unknown = row, person: unknown = principal, at = now) =>
  validateSessionInstanceToken(token, value, person, secret, at);

describe("disconnected v2 session instance contracts", () => {
  it("binds exact instance, principal, epoch and issue time without granting membership", () => {
    expect(read()).toEqual({
      principalId: row.principalId,
      sessionBinding: row.id,
      validUntilMs: row.expiresAtMs,
    });
    expect(Object.isFrozen(read())).toBe(true);
    expect(createSessionInstanceToken(row, secret)).toBe(token);
    for (const changed of [
      { ...row, id: "synthetic_instance_00000000000002" },
      { ...row, principalId: "other-user" },
      { ...row, issuedAtMs: now - 1 },
    ])
      expect(read(changed)).toBeNull();
  });

  it("denies disabled/deleted principals, revoked instances and any moved epoch", () => {
    for (const person of [
      null,
      { ...principal, disabled: true },
      { ...principal, authzEpoch: 2 },
      { ...principal, authzEpoch: 4 },
      { ...principal, id: "other-user" },
    ])
      expect(read(row, person)).toBeNull();
    expect(read({ ...row, revokedAtMs: now })).toBeNull();
    expect(read({ ...row, revokedAtMs: now + 100 })).toBeNull();
    expect(read(null)).toBeNull();
  });

  it("expires at the server row deadline and enforces the existing seven-day maximum", () => {
    expect(read(row, principal, row.expiresAtMs - 1)).not.toBeNull();
    expect(read(row, principal, row.expiresAtMs)).toBeNull();
    expect(read(row, principal, now - 1)).toBeNull();
    const maximum = { ...row, expiresAtMs: now + SESSION_MAX_AGE_SECONDS * 1_000 };
    expect(sessionInstanceSchema.safeParse(maximum).success).toBe(true);
    expect(
      sessionInstanceSchema.safeParse({ ...maximum, expiresAtMs: maximum.expiresAtMs + 1 }).success,
    ).toBe(false);
    expect(read(row, principal, NaN)).toBeNull();
  });

  it("rejects malformed rows, tampered tokens and missing secrets", () => {
    for (const value of [
      { ...row, authzEpochAtIssue: -1 },
      { ...row, id: row.principalId },
      { ...row, expiresAtMs: now },
      { ...row, role: "ADMIN" },
    ])
      expect(read(value)).toBeNull();
    for (const value of [
      null,
      {},
      "",
      `${token}x`,
      token.replace("v2.", "v3."),
      `v2.${"a".repeat(254)}`,
      `${token}\n`,
    ])
      expect(validateSessionInstanceToken(value, row, principal, secret, now)).toBeNull();
    expect(validateSessionInstanceToken(token, row, principal, "wrong", now)).toBeNull();
    expect(validateSessionInstanceToken(token, row, principal, "", now)).toBeNull();
  });

  it("keeps existing v1 behavior while refusing v1-to-v2 and v2-to-v1 fallback", () => {
    const legacy = createSessionToken(principal.id, secret, now);
    expect(readSessionToken(legacy, secret, now)).toBe(principal.id);
    expect(validateSessionInstanceToken(legacy, row, principal, secret, now)).toBeNull();
    expect(readSessionToken(token, secret, now)).toBeNull();
    expect(validateSessionInstanceToken(token.slice(3), row, principal, secret, now)).toBeNull();
  });
});
