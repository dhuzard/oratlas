import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import {
  KNOWN_NOTIFICATION_SQL_READ_AT,
  type KnownPublicSqlState,
} from "./known-mutation-state.js";
import type { WorkerArtifactScenario } from "./worker-artifact-scenarios.js";

/** All fields retained: selected credential auth stamp and one declared artifact completion only. */
export function expectedWorkerArtifactState(
  before: KnownPublicSqlState,
  scenario: Pick<WorkerArtifactScenario, "credentialStamp" | "completeArtifact">,
): KnownPublicSqlState {
  if (canonicalJson(Object.keys(before).sort()) !== canonicalJson(PUBLIC_SELECT_TABLES))
    throw new Error("Incomplete worker artifact snapshot inventory");
  const credentialId =
    scenario.credentialStamp === "primary"
      ? "g1-worker-verifier-submit-only"
      : scenario.credentialStamp === "other"
        ? "g1-worker-verifier-wrong-owner-submit"
        : null;
  if (
    credentialId &&
    before.VerifierCredential!.filter((row) => row.id === credentialId).length !== 1
  )
    throw new Error("Worker artifact credential target missing");
  if (
    scenario.completeArtifact &&
    before.VerificationArtifact!.filter(
      (row) =>
        row.id === scenario.completeArtifact &&
        row.status === "uploaded" &&
        row.completedAt === null,
    ).length !== 1
  )
    throw new Error("Worker artifact transition target invalid");
  return {
    ...before,
    VerifierCredential: before.VerifierCredential!.map((row) =>
      row.id === credentialId ? { ...row, lastUsedAt: KNOWN_NOTIFICATION_SQL_READ_AT } : row,
    ),
    VerificationArtifact: before.VerificationArtifact!.map((row) =>
      row.id === scenario.completeArtifact
        ? { ...row, status: "completed", completedAt: KNOWN_NOTIFICATION_SQL_READ_AT }
        : row,
    ),
  };
}
export function workerArtifactStateProblems(
  before: KnownPublicSqlState,
  after: KnownPublicSqlState,
  scenario: Pick<WorkerArtifactScenario, "credentialStamp" | "completeArtifact">,
): string[] {
  return canonicalJson(after) === canonicalJson(expectedWorkerArtifactState(before, scenario))
    ? []
    : ["Unexpected worker artifact row or field delta"];
}
