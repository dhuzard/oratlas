import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1_000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function signaturesMatch(payload: string, signature: string, secret: string): boolean {
  const expected = sign(payload, secret);
  const expectedBytes = Buffer.from(expected);
  const signatureBytes = Buffer.from(signature);
  return (
    expectedBytes.length === signatureBytes.length && timingSafeEqual(expectedBytes, signatureBytes)
  );
}

export function createSessionToken(
  userId: string,
  secret: string,
  issuedAtMs = Date.now(),
): string {
  if (!userId || userId.includes(".")) throw new TypeError("Invalid session user id.");
  if (!Number.isSafeInteger(issuedAtMs) || issuedAtMs < 0) {
    throw new TypeError("Invalid session issue time.");
  }
  const payload = `${userId}.${issuedAtMs}`;
  return `${payload}.${sign(payload, secret)}`;
}

/** Verify authenticity and server-side lifetime, returning the user id when valid. */
export function readSessionToken(token: string, secret: string, nowMs = Date.now()): string | null {
  const signatureSeparator = token.lastIndexOf(".");
  if (signatureSeparator <= 0) return null;
  const payload = token.slice(0, signatureSeparator);
  const signature = token.slice(signatureSeparator + 1);
  if (!signature || !signaturesMatch(payload, signature, secret)) return null;

  const timestampSeparator = payload.lastIndexOf(".");
  if (timestampSeparator <= 0) return null;
  const userId = payload.slice(0, timestampSeparator);
  const timestampText = payload.slice(timestampSeparator + 1);
  if (!userId || !/^\d+$/.test(timestampText)) return null;

  const issuedAtMs = Number(timestampText);
  if (!Number.isSafeInteger(issuedAtMs)) return null;
  // Reject future-issued tokens as well as expired ones. Both conditions are
  // checked after signature verification to avoid exposing token structure.
  if (issuedAtMs > nowMs || nowMs - issuedAtMs > SESSION_MAX_AGE_MS) return null;
  return userId;
}
