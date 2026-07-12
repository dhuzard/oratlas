import { createHash } from "node:crypto";

/**
 * Canonical SHA-256 hex digest over UTF-8 text. Capture payloads, submission
 * payloads and preserved file contents are all hashed with exactly this
 * function; producers and verifiers must share it.
 */
export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
