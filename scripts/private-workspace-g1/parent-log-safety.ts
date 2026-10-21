import { createHmac } from "node:crypto";
import { nativeLogEvidenceProblems } from "./native-evidence-safety.js";
import { cookieHeader, NEGATIVE_SESSIONS, PRINCIPAL_LABELS, validSession } from "./principals.js";

/** Closed synthetic recipe contract, matching the pinned native session-token payload/HMAC.
 * No app import, authentication replacement, output rewrite, or additional child execution.
 */
export function parentLogSecrets(databaseSecrets: readonly string[]): string[] {
  const secrets = new Set(databaseSecrets.filter(Boolean));
  for (const raw of databaseSecrets) {
    try {
      const url = new URL(raw);
      for (const part of [url.password, decodeURIComponent(url.password)])
        if (part) secrets.add(part);
    } catch {
      /* A decoded password is already in the explicit pool. */
    }
  }
  for (const recipe of [
    ...PRINCIPAL_LABELS.filter((label) => label !== "anonymous").map(validSession),
    ...NEGATIVE_SESSIONS,
  ]) {
    const header = cookieHeader(recipe, (user, key, time) => {
      const payload = `${user}.${time}`;
      return `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
    });
    if (!header) continue;
    secrets.add(header);
    const value = header.slice(header.indexOf("=") + 1);
    const split = value.lastIndexOf(".");
    if (split > 0)
      for (const part of [value, value.slice(0, split), value.slice(split + 1)]) secrets.add(part);
  }
  return [...secrets];
}

/** Complete raw text plus complete JSON lines only; embedded non-JSON/ANSI is not decoded.
 * A refusal is fixed text and must precede every diagnostic, redactor, console or file sink.
 */
export function parentLogRefused(raw: string, secrets: readonly string[]): boolean {
  return nativeLogEvidenceProblems(raw, parentLogSecrets(secrets)).length > 0;
}
