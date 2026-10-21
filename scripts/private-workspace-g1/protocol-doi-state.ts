import type { HttpRecord } from "./capture.js";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import type { KnownPublicSqlState } from "./known-mutation-state.js";
import { nativeEvidenceProblems } from "./native-evidence-safety.js";
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
  return nativeEvidenceProblems([records, state], cookieSecrets).length
    ? ["Protocol/DOI capability disclosure refused"]
    : [];
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
