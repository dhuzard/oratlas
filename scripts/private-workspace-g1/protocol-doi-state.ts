import type { HttpRecord } from "./capture.js";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import type { KnownPublicSqlState } from "./known-mutation-state.js";
import { workerOutputProblems } from "./worker-capture-safety.js";
export function protocolDoiStateProblems(
  before: KnownPublicSqlState,
  after: KnownPublicSqlState,
): string[] {
  if (
    canonicalJson(Object.keys(before).sort()) !== canonicalJson(PUBLIC_SELECT_TABLES) ||
    canonicalJson(Object.keys(after).sort()) !== canonicalJson(PUBLIC_SELECT_TABLES)
  )
    return ["Incomplete protocol/DOI state scope"];
  return canonicalJson(before) === canonicalJson(after)
    ? []
    : ["Unexpected protocol/DOI public row or field change"];
}
export function protocolDoiOutputProblems(
  records: readonly Pick<HttpRecord, "headers" | "setCookie" | "bodyBase64">[],
  state: unknown,
  cookieSecrets: readonly string[],
): string[] {
  if (
    records.some(
      (record) =>
        record.setCookie.length !== 0 || record.headers.some(([key]) => key === "location"),
    )
  )
    return ["Unexpected protocol/DOI cookie or redirect refused"];
  const values = [
    JSON.stringify(records),
    JSON.stringify(state),
    ...records.map((record) => Buffer.from(record.bodyBase64, "base64").toString("utf8")),
  ];
  const pending: unknown[] = [...values];
  let visited = 0;
  while (pending.length) {
    if (++visited > 250_000) return ["Protocol/DOI disclosure inspection bound refused"];
    const value = pending.pop();
    if (typeof value === "string") {
      if (
        value.length > 16 * 1024 * 1024 ||
        workerOutputProblems(value).length ||
        cookieSecrets.some(
          (secret) =>
            secret.length > 0 &&
            (value.includes(secret) || value.includes(JSON.stringify(secret).slice(1, -1))),
        )
      )
        return ["Protocol/DOI capability disclosure refused"];
      try {
        pending.push(JSON.parse(value));
      } catch {
        /* Ordinary public text. */
      }
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) pending.push(key, child);
    }
  }
  return [];
}

/** Refuse raw values before an assertion framework or validator can format diagnostics. */
export function assertProtocolDoiOutputSafe(
  records: readonly Pick<HttpRecord, "headers" | "setCookie" | "bodyBase64">[],
  state: unknown,
  cookieSecrets: readonly string[],
): void {
  if (protocolDoiOutputProblems(records, state, cookieSecrets).length)
    throw new Error("Protocol/DOI capability output refused");
}
