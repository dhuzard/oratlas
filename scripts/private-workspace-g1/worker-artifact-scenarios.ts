import { readFileSync } from "node:fs";
import { NO_SESSION, PRINCIPAL_LABELS, validSession } from "./principals.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";
import type { WorkerAuthority, WorkerCredentialCase } from "./worker-authority.js";
import { WORKER_READ_FIXTURE_DELTAS, WORKER_READ_FIXTURE_FILES } from "./worker-read-scenarios.js";
import type { SupplementalProgram } from "./supplemental-channel.js";

export const ARTIFACT_INPUTS = JSON.parse(
  readFileSync(new URL("./fixtures/worker-artifact-inputs.json", import.meta.url), "utf8"),
) as {
  ids: Record<
    "run" | "uploaded" | "completed" | "prepared" | "priorOwner" | "expired" | "finding",
    string
  >;
  requests: {
    bodies: Record<string, Record<string, string>>;
    metadata: Record<string, Record<string, string | number>>;
    finding: Record<string, unknown>;
  };
  addedRows: Record<string, number>;
  initialArtifactRows: Array<Record<string, unknown>>;
  initialCredentials: Array<Record<string, unknown>>;
  runInputSha256: string;
  runInputSchemaVersion: string;
  findingPayloadSha256: string;
};
export type WorkerArtifactScenario = HttpScenario & {
  readonly workerAuthority: WorkerAuthority;
  readonly params: { readonly id: string };
  readonly credentialStamp: "primary" | "other" | null;
  readonly completeArtifact?: string;
};
/** Bootstrap-only update to an existing worker fixture row, not an additional runtime mutation. */
export const WORKER_ARTIFACT_SETUP_UPDATES = [
  {
    table: "VerifierCredential",
    id: "g1-worker-verifier-submit-only",
    fields: {
      lastUsedAt: ARTIFACT_INPUTS.initialCredentials.find(
        (row) => row.id === "g1-worker-verifier-submit-only",
      )!.lastUsedAt,
    },
  },
] as const;
export const WORKER_ARTIFACT_COLUMN_UPDATES = [
  { table: "VerificationArtifact", columns: ["status", "completedAt"] },
] as const;
const fail = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
const leaseDenial = fail(
  403,
  "forbidden",
  "A valid active lease for this verifier and run is required.",
);
const artifactOwnerDenial = fail(403, "forbidden", "Artifact belongs to another verifier.");
const ids = ARTIFACT_INPUTS.ids;
const artifact = (id: string, status: string, replayed = true): HttpExpectation => ({
  status: 200,
  json: [
    { pointer: "/id", equals: id },
    { pointer: "/verificationRunId", equals: ids.run },
    { pointer: "/status", equals: status },
    ...(replayed
      ? [{ pointer: "/replayed", equals: true } as const]
      : [{ pointer: "/replayed", absent: true } as const]),
    {
      pointer: "/sha256",
      equals: ARTIFACT_INPUTS.initialArtifactRows.find((row) => row.id === id)!.sha256,
    },
    { pointer: "/provenance/credentialId", equals: "g1-worker-verifier-submit-only" },
    { pointer: "/provenance/leaseGeneration", equals: 2 },
  ],
});
const positive = {
  prepare: {
    status: 200,
    json: [
      { pointer: "/artifactId", equals: ids.prepared },
      { pointer: "/status", equals: "prepared" },
      { pointer: "/replayed", equals: true },
      { pointer: "/upload/method", equals: "PUT" },
      { pointer: "/upload/href", equals: `/api/verification-artifacts/${ids.prepared}/content` },
      { pointer: "/expiresAt", equals: "2026-04-01T00:03:00.000Z" },
    ],
  } as HttpExpectation,
  upload: artifact(ids.uploaded, "uploaded"),
  complete: artifact(ids.completed, "completed"),
  finding: {
    status: 200,
    json: [
      { pointer: "/id", equals: ids.finding },
      { pointer: "/verificationRunId", equals: ids.run },
      { pointer: "/status", equals: "not-applicable" },
      { pointer: "/replayed", equals: true },
      { pointer: "/artifactRefs", equals: [ids.completed] },
      { pointer: "/evidenceRefs/0/id", equals: "g1-worker-source" },
      { pointer: "/evidenceRefs/0/type", equals: "capture" },
      { pointer: "/payloadSha256", equals: ARTIFACT_INPUTS.findingPayloadSha256 },
    ],
  } as HttpExpectation,
};
type Operation = keyof typeof positive;
const routes: Record<
  Operation,
  { route: string; method: "POST" | "PUT"; path: (id: string) => string }
> = {
  prepare: {
    route: "api/verification-runs/[id]/artifacts/prepare",
    method: "POST",
    path: (id) => `/api/verification-runs/${id}/artifacts/prepare`,
  },
  upload: {
    route: "api/verification-artifacts/[id]/content",
    method: "PUT",
    path: (id) => `/api/verification-artifacts/${id}/content`,
  },
  complete: {
    route: "api/verification-runs/[id]/artifacts/complete",
    method: "POST",
    path: (id) => `/api/verification-runs/${id}/artifacts/complete`,
  },
  finding: {
    route: "api/verification-runs/[id]/findings",
    method: "POST",
    path: (id) => `/api/verification-runs/${id}/findings`,
  },
};
const bodies = {
  prepare: ARTIFACT_INPUTS.requests.metadata.prepared!,
  upload: ARTIFACT_INPUTS.requests.bodies.uploaded!,
  complete: { artifactId: ids.completed },
  finding: ARTIFACT_INPUTS.requests.finding,
};

/** Case-major order keeps every cookie recipe at the same native artifact state. */
export function workerArtifactScenarios(): WorkerArtifactScenario[] {
  const result: WorkerArtifactScenario[] = [];
  const add = (
    operation: Operation,
    name: string,
    expectation: HttpExpectation,
    options: {
      credential?: WorkerCredentialCase;
      lease?: WorkerAuthority["lease"];
      target?: string;
      body?: unknown;
      headers?: Record<string, string>;
      stamp?: "primary" | "other" | null;
    } = {},
  ) => {
    for (const principal of PRINCIPAL_LABELS) {
      const suffix = principal.toLowerCase().replaceAll("+", "-and-");
      const credential = options.credential ?? "submit-only";
      const target = options.target ?? (operation === "upload" ? ids.uploaded : ids.run);
      result.push({
        kind: "http",
        id: `worker-artifact-${operation}-${name}-${suffix}`,
        ...routes[operation],
        path: routes[operation].path(target),
        params: { id: target },
        principal,
        session: principal === "anonymous" ? NO_SESSION : validSession(principal),
        workerAuthority: { kind: "verifier", credential, lease: options.lease ?? "active" },
        headers: { "content-type": "application/json", ...options.headers },
        body: options.body ?? bodies[operation],
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
            : { sameResponseAs: `worker-artifact-${operation}-${name}-anonymous` }),
          bodyExcludes: [
            '"tokenHash"',
            '"leaseTokenHash"',
            '"scopesJson"',
            "oratlas_verify_",
            "oratlas_lease_",
          ],
        },
      });
    }
  };
  for (const operation of Object.keys(routes) as Operation[]) {
    add(operation, "replay", positive[operation]);
    add(
      operation,
      "read-only",
      fail(403, "forbidden", "Credential lacks verification:submit scope."),
      { credential: "active" },
    );
    add(operation, "wrong-verifier-lease", leaseDenial, { credential: "wrong-owner-submit" });
    for (const credential of ["expired", "revoked", "inactive", "bad-hash", "unknown"] as const)
      add(
        operation,
        credential,
        credential === "inactive"
          ? fail(403, "forbidden", "The verifier is not active.")
          : credential === "expired" || credential === "revoked"
            ? fail(401, "unauthorized", "The verifier credential is revoked or expired.")
            : fail(401, "unauthorized", "A valid verifier bearer credential is required."),
        { credential },
      );
    for (const lease of ["wrong", "missing"] as const)
      add(operation, `lease-${lease}`, leaseDenial, { lease });
    add(operation, "expired-run", leaseDenial, {
      target: operation === "upload" ? ids.expired : "g1-worker-run-expired",
    });
    add(
      operation,
      "missing-target",
      fail(
        404,
        "not-found",
        operation === "upload" ? "Verification artifact not found." : "Verification run not found.",
      ),
      { target: "g1-worker-missing" },
    );
  }
  add(
    "prepare",
    "metadata-collision",
    fail(409, "conflict", "Artifact key is bound to different immutable metadata."),
    { body: { ...bodies.prepare, sha256: "0".repeat(64) } },
  );
  add(
    "upload",
    "digest-mismatch",
    fail(409, "conflict", "Uploaded bytes do not match prepared media type, length, and SHA-256."),
    { body: { ...bodies.upload, role: "tampered-transition" } },
  );
  add(
    "upload",
    "media-mismatch",
    fail(409, "conflict", "Uploaded bytes do not match prepared media type, length, and SHA-256."),
    { headers: { "content-type": "text/plain" } },
  );
  add("upload", "previous-artifact-owner", artifactOwnerDenial, {
    target: ids.priorOwner,
    body: ARTIFACT_INPUTS.requests.bodies.priorOwner,
  });
  add("complete", "previous-artifact-owner", artifactOwnerDenial, {
    body: { artifactId: ids.priorOwner },
  });
  add(
    "upload",
    "oversized-length",
    fail(413, "payload-too-large", "Verification artifact exceeds 8 MiB."),
    { headers: { "content-length": "8388609" }, stamp: null },
  );
  add("complete", "foreign-artifact", fail(404, "not-found", "Artifact is not part of this run."), {
    body: { artifactId: "g1-protocol-artifact-public" },
  });
  add(
    "complete",
    "prepared-without-blob",
    fail(409, "conflict", "Uploaded artifact has not passed its length and SHA-256 checks."),
    { body: { artifactId: ids.prepared } },
  );
  add(
    "finding",
    "immutable-collision",
    fail(409, "conflict", "Finding key is bound to a different immutable payload."),
    { body: { ...bodies.finding, rationale: "Different synthetic rationale." } },
  );
  add(
    "finding",
    "outside-frozen-packet",
    fail(
      400,
      "bad-request",
      "Evidence reference capture:g1-discovery-source is absent from the frozen input.",
    ),
    { body: { ...bodies.finding, evidenceRefs: [{ type: "capture", id: "g1-discovery-source" }] } },
  );
  for (const [name, id] of [
    ["foreign", "g1-protocol-artifact-public"],
    ["prepared", ids.prepared],
    ["uploaded", ids.uploaded],
  ] as const)
    add(
      "finding",
      `${name}-artifact`,
      fail(400, "bad-request", "Findings may cite only completed artifacts from the same run."),
      { body: { ...bodies.finding, artifactRefs: [id] } },
    );
  add(
    "finding",
    "invalid-schema",
    fail(400, "bad-request", "Verification request does not satisfy the public contract."),
    { body: { findingKey: "INVALID" } },
  );
  // Exactly one native uploaded -> completed update, followed by genuine completed replays.
  add("complete", "transition", artifact(ids.uploaded, "completed", false), {
    body: { artifactId: ids.uploaded },
  });
  const transition = result.splice(
    result.length - PRINCIPAL_LABELS.length,
    PRINCIPAL_LABELS.length,
  )[0]!;
  result.push({ ...transition, completeArtifact: ids.uploaded });
  add("complete", "transition-replay", artifact(ids.uploaded, "completed"), {
    body: { artifactId: ids.uploaded },
  });
  result[result.length - PRINCIPAL_LABELS.length] = {
    ...result[result.length - PRINCIPAL_LABELS.length]!,
    repeatOf: transition.id,
  };
  return result;
}
export const WORKER_ARTIFACT_FIXTURE_DELTAS = Object.fromEntries(
  [
    ...new Set([
      ...Object.keys(WORKER_READ_FIXTURE_DELTAS),
      ...Object.keys(ARTIFACT_INPUTS.addedRows),
    ]),
  ].map((table) => [
    table,
    (WORKER_READ_FIXTURE_DELTAS[table as keyof typeof WORKER_READ_FIXTURE_DELTAS] ?? 0) +
      (ARTIFACT_INPUTS.addedRows[table] ?? 0),
  ]),
);
export const WORKER_ARTIFACT_PROGRAM: SupplementalProgram = {
  name: "worker-artifacts",
  spec: "scripts/private-workspace-g1/worker-artifacts.g1.spec.ts",
  outVariable: "G1_WORKER_ARTIFACT_OUT",
  stateSuffix: ".state.json",
  scenarios: workerArtifactScenarios(),
  fixtures: [...WORKER_READ_FIXTURE_FILES, "worker-artifact-fixtures.sql"],
  addedRows: WORKER_ARTIFACT_FIXTURE_DELTAS,
};
