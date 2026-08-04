import { describe, expect, it } from "vitest";
import {
  createLlmCredentialToken,
  LLM_CREDENTIAL_MAX_AGE_SECONDS,
  readLlmCredentialToken,
} from "./llm-credential-token";

const secret = "test-session-secret-that-is-long-enough";
const issuedAt = 1_800_000_000_000;

describe("LLM credential token", () => {
  it("round-trips an encrypted short-lived credential without exposing the key", () => {
    const token = createLlmCredentialToken(
      { provider: "openai", apiKey: "sk-test-private-key", model: "gpt-5" },
      secret,
      issuedAt,
    );
    expect(token).not.toContain("sk-test-private-key");
    expect(
      readLlmCredentialToken(token, secret, issuedAt + 1_000),
    ).toMatchObject({
      version: 1,
      provider: "openai",
      apiKey: "sk-test-private-key",
      model: "gpt-5",
      issuedAtMs: issuedAt,
      expiresAtMs: issuedAt + LLM_CREDENTIAL_MAX_AGE_SECONDS * 1_000,
    });
  });

  it("fails closed on tampering, a different secret, future issuance, and expiry", () => {
    const token = createLlmCredentialToken(
      { provider: "anthropic", apiKey: "sk-ant-test-private", model: "claude-test" },
      secret,
      issuedAt,
    );
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    expect(readLlmCredentialToken(tampered, secret, issuedAt + 1)).toBeNull();
    expect(readLlmCredentialToken(token, `${secret}-other`, issuedAt + 1)).toBeNull();
    expect(readLlmCredentialToken(token, secret, issuedAt - 1)).toBeNull();
    expect(
      readLlmCredentialToken(
        token,
        secret,
        issuedAt + LLM_CREDENTIAL_MAX_AGE_SECONDS * 1_000,
      ),
    ).toBeNull();
  });

  it("rejects malformed provider, key, and model inputs", () => {
    expect(() =>
      createLlmCredentialToken(
        { provider: "openai", apiKey: "short", model: "gpt-5" },
        secret,
        issuedAt,
      ),
    ).toThrow("API key");
    expect(() =>
      createLlmCredentialToken(
        { provider: "openai", apiKey: "sk-test-private-key", model: "bad\nmodel" },
        secret,
        issuedAt,
      ),
    ).toThrow("model");
  });
});
