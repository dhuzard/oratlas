import { workerOutputProblems } from "./worker-capture-safety.js";
/** Inspection only: retained native response and SQL bytes are never rewritten. */
export function auditRevokeDisclosureProblems(
  value: unknown,
  secrets: readonly string[],
): string[] {
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length) {
    if (++visited > 250_000) return ["Audit revocation disclosure inspection bound refused"];
    const entry = pending.pop();
    if (typeof entry === "string") {
      if (
        entry.length > 16 * 1024 * 1024 ||
        workerOutputProblems(entry).length ||
        secrets.some(
          (secret) =>
            secret &&
            (entry.includes(secret) || entry.includes(JSON.stringify(secret).slice(1, -1))),
        )
      )
        return ["Audit revocation capability disclosure refused"];
      if (entry.trimStart().startsWith("{") || entry.trimStart().startsWith("[")) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(entry);
        } catch {
          continue;
        }
        pending.push(parsed);
      }
    } else if (entry && typeof entry === "object") {
      for (const [key, child] of Object.entries(entry)) pending.push(key, child);
    }
  }
  return [];
}

/** Native cookie payload and signature are capabilities; public user id/time separately are not. */
export function auditRevokeCookieSecrets(header: string): string[] {
  const prefix = "oratlas_session=";
  if (!header.startsWith(prefix)) throw Error("Unexpected audit revocation cookie layout");
  const value = header.slice(prefix.length);
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1)
    throw Error("Unexpected audit revocation cookie layout");
  return [header, value, value.slice(0, separator), value.slice(separator + 1)];
}
