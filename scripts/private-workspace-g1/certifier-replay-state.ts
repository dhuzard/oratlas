import type { HttpRecord } from "./capture.js";
import { workerOutputProblems } from "./worker-capture-safety.js";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import {
  KNOWN_NOTIFICATION_SQL_READ_AT,
  type KnownPublicSqlState,
} from "./known-mutation-state.js";
import { CERTIFIER_INPUTS, type CertifierReplayScenario } from "./certifier-replay-scenarios.js";
/** Every field remains present; only the actually authenticated submit credential can be stamped. */
export function expectedCertifierReplayState(
  before: KnownPublicSqlState,
  scenario: Pick<CertifierReplayScenario, "credentialStamp">,
): KnownPublicSqlState {
  if (canonicalJson(Object.keys(before).sort()) !== canonicalJson(PUBLIC_SELECT_TABLES))
    throw new Error("Incomplete certifier snapshot inventory");
  const id =
    scenario.credentialStamp === "primary"
      ? "g1-worker-certifier-submit-only"
      : scenario.credentialStamp === "other"
        ? CERTIFIER_INPUTS.otherCredentialId
        : null;
  if (id && before.CertifierCredential!.filter((row) => row.id === id).length !== 1)
    throw new Error("Certifier stamp target missing");
  return {
    ...before,
    CertifierCredential: before.CertifierCredential!.map((row) =>
      row.id === id ? { ...row, lastUsedAt: KNOWN_NOTIFICATION_SQL_READ_AT } : row,
    ),
  };
}
export function certifierReplayStateProblems(
  before: KnownPublicSqlState,
  after: KnownPublicSqlState,
  scenario: Pick<CertifierReplayScenario, "credentialStamp">,
): string[] {
  return canonicalJson(after) === canonicalJson(expectedCertifierReplayState(before, scenario))
    ? []
    : ["Unexpected certifier row or field delta"];
}

/** Refuse before either output is written; encoded response bodies are inspected as decoded bytes. */
export function certifierReplayCapabilityProblems(
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
    return ["Unexpected certifier cookie or redirect refused"];
  const retained = [
    JSON.stringify(state),
    JSON.stringify(records),
    ...records.map((record) => Buffer.from(record.bodyBase64, "base64").toString("utf8")),
  ];
  return retained.some(
    (value) =>
      workerOutputProblems(value).length || cookieSecrets.some((secret) => value.includes(secret)),
  )
    ? ["Certifier capability disclosure refused"]
    : [];
}
