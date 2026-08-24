import { describe, expect, it } from "vitest";
import { getServerEnv, parseAdminGithubUserIds } from "./index";

describe("ADMIN_GITHUB_USER_IDS", () => {
  it("parses and deduplicates immutable numeric GitHub IDs", () => {
    expect(parseAdminGithubUserIds("48721374: 42:48721374")).toEqual(["48721374", "42"]);
  });

  it.each(["dhuzard", "0", "-1", "1.5", "9007199254740992"])(
    "rejects an unsafe administrator identity value: %s",
    (value) => {
      expect(() => parseAdminGithubUserIds(value)).toThrow(/positive GitHub numeric user IDs/);
    },
  );

  it("exposes the parsed allowlist in server configuration", () => {
    const env = getServerEnv({
      NODE_ENV: "test",
      ADMIN_GITHUB_USER_IDS: "48721374:123",
    });

    expect(env.adminGithubUserIds).toEqual(["48721374", "123"]);
  });
});

describe("NEXT_PUBLIC_BASE_URL", () => {
  it("accepts an origin URL", () => {
    expect(
      getServerEnv({ NODE_ENV: "test", NEXT_PUBLIC_BASE_URL: "https://atlas.example" })
        .NEXT_PUBLIC_BASE_URL,
    ).toBe("https://atlas.example");
  });

  it.each([
    "https://atlas.example/docs",
    "https://atlas.example/?preview=1",
    "https://user:secret@atlas.example",
  ])("rejects a base URL that is not a bare origin: %s", (url) => {
    expect(() => getServerEnv({ NODE_ENV: "test", NEXT_PUBLIC_BASE_URL: url })).toThrow(
      /must be an origin/,
    );
  });

  it("requires an explicitly configured HTTPS non-local origin in production", () => {
    expect(() => getServerEnv({ NODE_ENV: "production", SESSION_SECRET: "secret" })).toThrow(
      /required in production/,
    );
    expect(() =>
      getServerEnv({
        NODE_ENV: "production",
        SESSION_SECRET: "secret",
        NEXT_PUBLIC_BASE_URL: "http://localhost:3000",
      }),
    ).toThrow(/non-local HTTPS origin/);
  });

  it.each([
    "https://localhost.",
    "https://api.localhost",
    "https://127.0.0.2",
    "https://0.0.0.0",
    "https://[::]",
    "https://[::1]",
    "https://[0:0:0:0:0:0:0:1]",
  ])("rejects a local production origin: %s", (url) => {
    expect(() =>
      getServerEnv({
        NODE_ENV: "production",
        SESSION_SECRET: "secret",
        NEXT_PUBLIC_BASE_URL: url,
      }),
    ).toThrow(/non-local HTTPS origin/);
  });
});

describe("ORA real evaluator configuration", () => {
  it("treats blank optional evaluator settings from .env.example as unset", () => {
    const env = getServerEnv({
      NODE_ENV: "test",
      ORA_CERTIFIER_API_TOKEN: "",
      ORA_EVALUATOR_PROVIDER: "",
      ORA_EVALUATOR_MODEL: "   ",
    });

    expect(env.ORA_EVALUATOR_PROVIDER).toBeUndefined();
    expect(env.ORA_EVALUATOR_MODEL).toBeUndefined();
    expect(env.oraCertificationEnabled).toBe(false);
  });

  it("requires an explicit scoped token, provider, model, and matching server credential", () => {
    expect(getServerEnv({ NODE_ENV: "test" }).oraCertificationEnabled).toBe(false);
    expect(
      getServerEnv({
        NODE_ENV: "test",
        ORA_CERTIFIER_API_TOKEN: "secret",
        ORA_EVALUATOR_PROVIDER: "anthropic",
        ORA_EVALUATOR_MODEL: "explicit-model",
      }).oraCertificationEnabled,
    ).toBe(false);
    expect(
      getServerEnv({
        NODE_ENV: "test",
        ORA_CERTIFIER_API_TOKEN: "secret",
        ORA_EVALUATOR_PROVIDER: "anthropic",
        ORA_EVALUATOR_MODEL: "explicit-model",
        ANTHROPIC_API_KEY: "provider-secret",
      }).oraCertificationEnabled,
    ).toBe(true);
  });

  it("does not enable ORA from the unrelated discussion provider configuration", () => {
    expect(
      getServerEnv({
        NODE_ENV: "test",
        LLM_PROVIDER: "anthropic",
        LLM_MODEL: "discussion-model",
        ANTHROPIC_API_KEY: "provider-secret",
      }).oraCertificationEnabled,
    ).toBe(false);
  });
});
