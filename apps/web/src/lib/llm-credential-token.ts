import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export const LLM_CREDENTIAL_MAX_AGE_SECONDS = 8 * 60 * 60;
const LLM_CREDENTIAL_MAX_AGE_MS = LLM_CREDENTIAL_MAX_AGE_SECONDS * 1_000;
const TOKEN_VERSION = "v1";
const AAD = Buffer.from("oratlas.llm-credential.v1", "utf8");

export type LlmProviderName = "anthropic" | "openai";

export interface LlmCredentialPayload {
  version: 1;
  provider: LlmProviderName;
  apiKey: string;
  model: string;
  issuedAtMs: number;
  expiresAtMs: number;
}

export function createLlmCredentialToken(
  input: { provider: LlmProviderName; apiKey: string; model: string },
  secret: string,
  issuedAtMs = Date.now(),
): string {
  validateInput(input.provider, input.apiKey, input.model);
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) {
    throw new TypeError("Invalid LLM credential issue time.");
  }
  const payload: LlmCredentialPayload = {
    version: 1,
    provider: input.provider,
    apiKey: input.apiKey,
    model: input.model,
    issuedAtMs,
    expiresAtMs: issuedAtMs + LLM_CREDENTIAL_MAX_AGE_MS,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    TOKEN_VERSION,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    tag.toString("base64url"),
  ].join(".");
}

export function readLlmCredentialToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): LlmCredentialPayload | null {
  if (token.length > 4_096 || !Number.isSafeInteger(nowMs) || nowMs < 0) return null;
  const [version, ivText, ciphertextText, tagText, extra] = token.split(".");
  if (version !== TOKEN_VERSION || !ivText || !ciphertextText || !tagText || extra) return null;
  try {
    const iv = Buffer.from(ivText, "base64url");
    const ciphertext = Buffer.from(ciphertextText, "base64url");
    const tag = Buffer.from(tagText, "base64url");
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) return null;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), iv);
    decipher.setAAD(AAD);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
      "utf8",
    );
    const parsed = parsePayload(JSON.parse(plaintext) as unknown);
    if (!parsed) return null;
    if (parsed.issuedAtMs > nowMs || parsed.expiresAtMs <= nowMs) return null;
    if (parsed.expiresAtMs - parsed.issuedAtMs !== LLM_CREDENTIAL_MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function deriveKey(secret: string): Buffer {
  if (secret.length < 16) throw new TypeError("LLM credential encryption secret is too short.");
  return createHash("sha256")
    .update("oratlas/byok/aes-256-gcm/v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

function parsePayload(value: unknown): LlmCredentialPayload | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    payload.version !== 1 ||
    (payload.provider !== "anthropic" && payload.provider !== "openai") ||
    typeof payload.apiKey !== "string" ||
    typeof payload.model !== "string" ||
    typeof payload.issuedAtMs !== "number" ||
    typeof payload.expiresAtMs !== "number" ||
    !Number.isSafeInteger(payload.issuedAtMs) ||
    !Number.isSafeInteger(payload.expiresAtMs)
  ) {
    return null;
  }
  try {
    validateInput(payload.provider, payload.apiKey, payload.model);
  } catch {
    return null;
  }
  return payload as unknown as LlmCredentialPayload;
}

function validateInput(provider: string, apiKey: string, model: string): void {
  if (provider !== "anthropic" && provider !== "openai") {
    throw new TypeError("Unsupported LLM provider.");
  }
  if (apiKey.length < 10 || apiKey.length > 512 || /\s/.test(apiKey)) {
    throw new TypeError("Invalid LLM API key.");
  }
  if (model.length < 1 || model.length > 120 || /[\u0000-\u001f\u007f]/.test(model)) {
    throw new TypeError("Invalid LLM model name.");
  }
}
