import { readFileSync } from "node:fs";
import { NO_SESSION, PRINCIPAL_LABELS, validSession } from "./principals.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";
import type { WorkerAuthority, WorkerCredentialCase } from "./worker-authority.js";
import { WORKER_READ_FIXTURE_DELTAS, WORKER_READ_FIXTURE_FILES } from "./worker-read-scenarios.js";
import type { SupplementalProgram } from "./supplemental-channel.js";

export const CERTIFIER_INPUTS = JSON.parse(
  readFileSync(new URL("./fixtures/certifier-replay-inputs.json", import.meta.url), "utf8"),
) as {
  otherCredentialId: string;
  terminalRunId: string;
  terminalCreatedAt: string;
  terminalCompletedAt: string;
  terminalPacketSha256: string;
  existingRunId: string;
  resultId: string;
  withdrawnId: string;
  resultSha256: string;
  existingPacketSha256: string;
  requests: {
    create: Record<string, unknown>;
    result: Record<string, unknown>;
    transition: { status: "failed"; reason: string };
    lifecycle: { kind: "withdrawn"; reason: string };
  };
  addedRows: Record<string, number>;
  primarySetupLastUsedAt: string;
};
export type CertifierReplayScenario = HttpScenario & {
  readonly workerAuthority: WorkerAuthority;
  readonly params: Readonly<Record<string, string>>;
  readonly credentialStamp: "primary" | "other" | null;
};
export const CERTIFIER_REPLAY_SETUP_UPDATES = [
  {
    table: "CertifierCredential",
    id: "g1-worker-certifier-submit-only",
    fields: { lastUsedAt: CERTIFIER_INPUTS.primarySetupLastUsedAt },
  },
] as const;
const deny = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
const data = CERTIFIER_INPUTS;
const positive: Record<string, HttpExpectation> = {
  create: {
    status: 200,
    json: [
      { pointer: "/id", equals: data.existingRunId },
      { pointer: "/status", equals: "completed" },
      { pointer: "/replayed", equals: true },
      { pointer: "/input/packetSha256", equals: data.existingPacketSha256 },
      { pointer: "/certifierId", equals: "g1-certifier-ora" },
    ],
  },
  result: {
    status: 200,
    json: [
      { pointer: "/id", equals: data.resultId },
      { pointer: "/certificationRunId", equals: data.existingRunId },
      { pointer: "/replayed", equals: true },
      { pointer: "/outcome", equals: "inconclusive" },
      { pointer: "/resultSha256", equals: data.resultSha256 },
      { pointer: "/lifecycle", length: 2 },
      { pointer: "/lifecycle/1/kind", equals: "withdrawn" },
    ],
  },
  transition: {
    status: 200,
    json: [
      { pointer: "/id", equals: data.terminalRunId },
      { pointer: "/status", equals: "failed" },
      { pointer: "/replayed", equals: true },
      { pointer: "/terminalReason", equals: data.requests.transition.reason },
      { pointer: "/completedAt", equals: data.terminalCompletedAt },
      { pointer: "/input/packetSha256", equals: data.terminalPacketSha256 },
    ],
  },
  lifecycle: {
    status: 201,
    json: [
      { pointer: "/id", equals: data.withdrawnId },
      { pointer: "/replayed", equals: true },
    ],
  },
};
type Operation = "create" | "result" | "transition" | "lifecycle";
const routes: Record<Operation, { route: string; path: (id: string) => string }> = {
  create: { route: "api/certification-runs", path: () => "/api/certification-runs" },
  result: {
    route: "api/certification-runs/[id]/result",
    path: (id) => `/api/certification-runs/${id}/result`,
  },
  transition: {
    route: "api/certification-runs/[id]/transition",
    path: (id) => `/api/certification-runs/${id}/transition`,
  },
  lifecycle: {
    route: "api/certification-results/[id]/lifecycle",
    path: (id) => `/api/certification-results/${id}/lifecycle`,
  },
};
/** Public cookie roles never supply certifier authority; each repeats the real bearer matrix. */
export function certifierReplayScenarios(): CertifierReplayScenario[] {
  const scenarios: CertifierReplayScenario[] = [];
  const add = (
    operation: Operation,
    name: string,
    expectation: HttpExpectation,
    options: {
      credential?: WorkerCredentialCase;
      target?: string;
      body?: unknown;
      headers?: Record<string, string>;
      stamp?: "primary" | "other" | null;
    } = {},
  ) => {
    for (const principal of PRINCIPAL_LABELS) {
      const suffix = principal.toLowerCase().replaceAll("+", "-and-");
      const credential = options.credential ?? "submit-only";
      const id =
        options.target ??
        (operation === "transition"
          ? data.terminalRunId
          : operation === "lifecycle"
            ? data.resultId
            : data.existingRunId);
      scenarios.push({
        kind: "http",
        id: `certifier-${operation}-${name}-${suffix}`,
        route: routes[operation].route,
        path: routes[operation].path(id),
        method: "POST",
        params: operation === "create" ? {} : { id },
        principal,
        session: principal === "anonymous" ? NO_SESSION : validSession(principal),
        workerAuthority: { kind: "certifier", credential },
        headers: { "content-type": "application/json", ...options.headers },
        body: options.body ?? data.requests[operation],
        credentialStamp:
          options.stamp !== undefined
            ? options.stamp
            : credential === "submit-only"
              ? "primary"
              : credential === "wrong-owner-submit"
                ? "other"
                : null,
        expect: {
          ...expectation,
          ...(principal === "anonymous"
            ? {}
            : { sameResponseAs: `certifier-${operation}-${name}-anonymous` }),
          bodyExcludes: [
            '"tokenHash"',
            '"scopesJson"',
            "oratlas_cert_",
            "oratlas_verify_",
            "oratlas_lease_",
          ],
        },
      });
    }
  };
  for (const operation of Object.keys(routes) as Operation[]) {
    add(operation, "native-replay", positive[operation]!);
    add(
      operation,
      "read-only",
      deny(403, "forbidden", "Credential lacks certification:submit scope."),
      { credential: "active" },
    );
    add(
      operation,
      "other-submit",
      operation === "create"
        ? deny(409, "conflict", "Protocol does not belong to the authenticated certifier.")
        : deny(
            403,
            "forbidden",
            operation === "lifecycle"
              ? "Result belongs to another certifier."
              : "Certification run belongs to another certifier.",
          ),
      { credential: "wrong-owner-submit" },
    );
    for (const credential of ["expired", "revoked", "inactive", "bad-hash", "unknown"] as const)
      add(
        operation,
        credential,
        credential === "inactive"
          ? deny(403, "forbidden", "The certifier is not active.")
          : credential === "expired" || credential === "revoked"
            ? deny(401, "unauthorized", "The certifier credential is revoked or expired.")
            : deny(401, "unauthorized", "A valid certifier bearer credential is required."),
        { credential },
      );
    add(
      operation,
      "invalid-schema",
      deny(400, "bad-request", "Certification request does not satisfy the public contract."),
      { body: { invalidSyntheticField: true } },
    );
    add(
      operation,
      "unsupported-media",
      deny(415, "unsupported-media-type", "Content-Type application/json is required."),
      { headers: { "content-type": "text/plain" }, stamp: null },
    );
    if (operation !== "create")
      add(
        operation,
        "missing-target",
        deny(
          404,
          "not-found",
          operation === "lifecycle"
            ? "Certification result not found."
            : "Certification run not found.",
        ),
        { target: "g1-certifier-missing" },
      );
  }
  add(
    "create",
    "immutable-collision",
    deny(409, "conflict", "Idempotency key is already bound to a different certification run."),
    { body: { ...data.requests.create, externalRunReference: "different-synthetic-reference" } },
  );
  add(
    "create",
    "missing-protocol",
    deny(409, "conflict", "Protocol does not belong to the authenticated certifier."),
    {
      body: {
        ...data.requests.create,
        certificationProtocolId: "g1-certifier-missing-protocol",
        idempotencyKey: "g1-certifier-missing-protocol",
      },
    },
  );
  add(
    "result",
    "immutable-collision",
    deny(409, "conflict", "This run already has a different immutable result."),
    { body: { ...data.requests.result, limitations: ["Different synthetic immutable payload."] } },
  );
  add(
    "result",
    "terminal-run",
    deny(409, "conflict", "Certification run is not open for result submission."),
    {
      target: data.terminalRunId,
      body: { ...data.requests.result, packetSha256: data.terminalPacketSha256 },
    },
  );
  add(
    "transition",
    "different-reason",
    deny(409, "conflict", "Certification run already has a different terminal state."),
    { body: { ...data.requests.transition, reason: "A different synthetic terminal reason." } },
  );
  add(
    "transition",
    "different-terminal-status",
    deny(409, "conflict", "Certification run already has a different terminal state."),
    { body: { status: "cancelled", reason: data.requests.transition.reason } },
  );
  add(
    "lifecycle",
    "different-reason",
    deny(409, "conflict", "A different withdrawn event already exists."),
    { body: { ...data.requests.lifecycle, reason: "A different synthetic withdrawal reason." } },
  );
  return scenarios;
}
export const CERTIFIER_REPLAY_FIXTURE_DELTAS = Object.fromEntries(
  [...new Set([...Object.keys(WORKER_READ_FIXTURE_DELTAS), ...Object.keys(data.addedRows)])].map(
    (table) => [
      table,
      (WORKER_READ_FIXTURE_DELTAS[table as keyof typeof WORKER_READ_FIXTURE_DELTAS] ?? 0) +
        (data.addedRows[table] ?? 0),
    ],
  ),
);
export const CERTIFIER_REPLAY_PROGRAM: SupplementalProgram = {
  name: "certifier-replays",
  spec: "certifier-replays.g1.spec.ts",
  outVariable: "G1_CERTIFIER_REPLAY_OUT",
  scenarios: certifierReplayScenarios(),
  fixtures: [...WORKER_READ_FIXTURE_FILES, "certifier-replay-fixtures.sql"].map(
    (file) => `fixtures/${file}`,
  ),
  addedRows: CERTIFIER_REPLAY_FIXTURE_DELTAS,
  stateSuffix: ".state.json",
};
