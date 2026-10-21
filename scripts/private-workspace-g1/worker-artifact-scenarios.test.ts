import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { publicationVersionPacketSchema } from "../../packages/contracts/src/publication-version-packets.js";
import {
  prepareVerificationArtifactSchema,
  submitVerificationFindingSchema,
  claimVerificationRunSchema,
  issueVerifierCredentialSchema,
} from "../../packages/contracts/src/verification.js";
import {
  ARTIFACT_INPUTS,
  workerArtifactScenarios,
  WORKER_ARTIFACT_PROGRAM,
  WORKER_ARTIFACT_COLUMN_UPDATES,
} from "./worker-artifact-scenarios.js";
import { PRINCIPAL_LABELS, sha256Text } from "./principals.js";
import { programProblems } from "./scenarios.js";
import { workerCredential, workerLease } from "./worker-authority.js";
import { workerOutputProblems } from "./worker-capture-safety.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import {
  expectedWorkerArtifactState,
  workerArtifactStateProblems,
} from "./worker-artifact-state.js";
import type { KnownPublicSqlState } from "./known-mutation-state.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const sql = fixture("worker-artifact-fixtures.sql");
const native = JSON.parse(fixture("worker-artifact-native.json"));
const rows = [
  ...sql.matchAll(
    /INSERT INTO "(\w+)" SELECT \(jsonb_populate_record\(NULL::"\w+", '((?:''|[^'])*)'::jsonb\)\)\.\*;/gu,
  ),
].map((match) => ({ table: match[1]!, row: JSON.parse(match[2]!.replaceAll("''", "'")) }));

it("declares four methods with six independent cookie recipes, meaningful replays and a single native completion", () => {
  const scenarios = workerArtifactScenarios();
  expect(scenarios).toHaveLength(379);
  expect(programProblems(scenarios)).toEqual([]);
  expect(scenarios.filter((s) => s.completeArtifact)).toHaveLength(1);
  expect(scenarios.at(-7)?.completeArtifact).toBe(ARTIFACT_INPUTS.ids.uploaded);
  for (const principal of PRINCIPAL_LABELS) {
    const own = scenarios.filter((s) => s.principal === principal);
    expect(
      new Set(own.filter((s) => s.expect.status === 200).map((s) => `${s.method} ${s.route}`)).size,
    ).toBe(4);
    expect(
      own.some(
        (s) =>
          s.id.includes("previous-artifact-owner") &&
          s.workerAuthority.credential === "submit-only" &&
          s.expect.denial?.message === "Artifact belongs to another verifier.",
      ),
    ).toBe(true);
    expect(
      own.filter((s) => s.id.includes("wrong-verifier-lease") && s.credentialStamp === "other"),
    ).toHaveLength(4);
    expect(
      own.filter((s) => s.id.includes("read-only") && s.credentialStamp === null),
    ).toHaveLength(4);
    expect(own.some((s) => s.id.includes("outside-frozen-packet") && s.expect.status === 400)).toBe(
      true,
    );
  }
  expect(WORKER_ARTIFACT_COLUMN_UPDATES).toEqual([
    { table: "VerificationArtifact", columns: ["status", "completedAt"] },
  ]);
  expect(Object.values(WORKER_ARTIFACT_PROGRAM.addedRows).reduce((a, b) => a + b, 0)).toBe(52);
});
it("retains every native fixture row, loads historical ownership before reclaim and changes only the dispatch lease digest", () => {
  expect(rows).toHaveLength(15);
  expect(
    Object.fromEntries(
      [...new Set(rows.map((row) => row.table))].map((table) => [
        table,
        rows.filter((row) => row.table === table).length,
      ]),
    ),
  ).toEqual(ARTIFACT_INPUTS.addedRows);
  const values = (table: string) => rows.filter((row) => row.table === table).map((row) => row.row);
  expect(values("VerificationRun")).toEqual([native.initialRun]);
  expect(values("VerificationRunLifecycleEvent")).toEqual(native.events);
  expect(values("VerificationArtifact")).toEqual(native.artifacts);
  expect(values("VerificationArtifactBlob")).toEqual(native.blobs);
  expect(values("VerificationFinding")).toEqual([native.finding]);
  expect(values("VerificationFindingArtifact")).toEqual(native.joins);
  expect(values("VerifierCredential")).toEqual(
    native.credentials.filter(
      (row: { id: string }) => row.id === "g1-worker-verifier-wrong-owner-submit",
    ),
  );
  const restored = [
    ...sql.matchAll(
      /FROM jsonb_populate_record\(NULL::"VerificationRun", '((?:''|[^'])*)'::jsonb\)/gu,
    ),
  ].map((match) => JSON.parse(match[1]!.replaceAll("''", "'")));
  expect(restored).toEqual([{ ...native.run, leaseTokenHash: sha256Text(workerLease()) }]);
  expect(sql.indexOf(`"id":"${ARTIFACT_INPUTS.ids.priorOwner}"`)).toBeLessThan(
    sql.indexOf('UPDATE "VerificationRun"'),
  );
  expect(sql.indexOf(`"id":"${ARTIFACT_INPUTS.ids.uploaded}"`)).toBeGreaterThan(
    sql.indexOf('UPDATE "VerificationRun"'),
  );
  expect(sql).toContain(
    `UPDATE "VerifierCredential" SET "lastUsedAt"='${native.credentials.find((row: { id: string }) => row.id === "g1-worker-verifier-submit-only").lastUsedAt}'`,
  );
  expect(sql).not.toMatch(
    /\b(?:DISABLE TRIGGER|session_replication_role|DROP|ALTER|GRANT|TRUNCATE)\b/u,
  );
  expect(
    workerOutputProblems(
      sql + fixture("worker-artifact-inputs.json") + fixture("worker-artifact-native.json"),
    ),
  ).toEqual([]);
});
it("binds native packet, claim/reclaim, scopes and artifact/finding byte identities", () => {
  const packet = publicationVersionPacketSchema.parse(JSON.parse(native.run.inputJson));
  expect(sha256Text(canonicalJson(packet))).toBe(native.run.inputSha256);
  expect(packet.version.id).toBe("g1-worker-version");
  expect(native.run.inputJson).toBe(canonicalJson(JSON.parse(fixture("worker-input.json"))));
  expect(native.events.map((row: { kind: string }) => row.kind)).toEqual([
    "requested",
    "claimed",
    "reclaimed",
    "running",
  ]);
  for (const [index, run, credential] of [
    [1, native.initialRun, "g1-worker-verifier-wrong-owner-submit"],
    [2, native.run, "g1-worker-verifier-submit-only"],
  ] as const) {
    const details = JSON.parse(native.events[index].detailsJson);
    expect(details).toEqual({
      credentialId: credential,
      leaseExpiresAt: run.leaseExpiresAt,
      leaseGeneration: index,
    });
    expect(native.events[index].actorVerifierId).toBe(run.claimedVerifierId);
    const seconds = (Date.parse(run.leaseExpiresAt) - Date.parse(run.leaseIssuedAt)) / 1000;
    expect(claimVerificationRunSchema.parse({ leaseSeconds: seconds }).leaseSeconds).toBe(300);
  }
  for (const credential of native.credentials) {
    expect(
      issueVerifierCredentialSchema.parse({
        label: credential.label,
        scopes: JSON.parse(credential.scopesJson),
        expiresAt: credential.expiresAt,
      }).scopes,
    ).toEqual(["verification:submit"]);
  }
  const other = native.credentials.find(
    (row: { id: string }) => row.id === "g1-worker-verifier-wrong-owner-submit",
  );
  expect(other.tokenHash).toBe(workerCredential("verifier", "wrong-owner-submit").tokenHash);
  for (const key of ["uploaded", "completed", "prepared", "priorOwner", "expired"] as const) {
    const metadata = prepareVerificationArtifactSchema.parse(
      ARTIFACT_INPUTS.requests.metadata[key],
    );
    const bytes = JSON.stringify(ARTIFACT_INPUTS.requests.bodies[key]);
    expect(metadata.sha256).toBe(sha256Text(bytes));
    expect(metadata.byteLength).toBe(Buffer.byteLength(bytes));
    const row = native.artifacts.find((row: { id: string }) => row.id === ARTIFACT_INPUTS.ids[key]);
    for (const field of Object.keys(metadata) as Array<keyof typeof metadata>)
      expect(row[field]).toBe(metadata[field]);
    const blob = native.blobs.find((blob: { artifactId: string }) => blob.artifactId === row.id);
    if (key === "uploaded" || key === "completed")
      expect(Buffer.from(blob.bytes.slice(2), "hex").toString()).toBe(bytes);
    else expect(blob).toBeUndefined();
  }
  const finding = submitVerificationFindingSchema.parse(ARTIFACT_INPUTS.requests.finding);
  expect(native.finding.payloadJson).toBe(canonicalJson(finding));
  expect(native.finding.payloadSha256).toBe(sha256Text(native.finding.payloadJson));
  expect(ARTIFACT_INPUTS.findingPayloadSha256).toBe(native.finding.payloadSha256);
  expect(native.joins).toEqual([
    {
      verificationFindingId: native.finding.id,
      verificationArtifactId: ARTIFACT_INPUTS.ids.completed,
    },
  ]);
});
it("rejects same-count hidden updates and retains all credential/artifact fields in state assertions", () => {
  const before = Object.fromEntries(
    PUBLIC_SELECT_TABLES.map((table) => [table, []]),
  ) as unknown as Record<string, Array<Record<string, unknown>>>;
  before.VerifierCredential = [
    {
      id: "g1-worker-verifier-submit-only",
      lastUsedAt: null,
      tokenHash: "frozen-hash",
      scopesJson: '["verification:submit"]',
    },
  ];
  before.VerificationArtifact = [
    { id: "known-uploaded", status: "uploaded", completedAt: null, sha256: "immutable-sha" },
  ];
  before.Review = [{ id: "existing", title: "unchanged" }];
  const scenario = { credentialStamp: "primary" as const, completeArtifact: "known-uploaded" };
  const after = expectedWorkerArtifactState(before as KnownPublicSqlState, scenario);
  expect(workerArtifactStateProblems(before, after, scenario)).toEqual([]);
  for (const changed of [
    { ...after, Review: [{ id: "existing", title: "changed" }] },
    { ...after, VerificationArtifact: [{ ...after.VerificationArtifact![0], sha256: "tampered" }] },
    {
      ...after,
      VerifierCredential: [
        { ...after.VerifierCredential![0], scopesJson: '["verification:read"]' },
      ],
    },
  ])
    expect(workerArtifactStateProblems(before, changed, scenario)).toEqual([
      "Unexpected worker artifact row or field delta",
    ]);
  const incomplete = { ...before };
  delete incomplete.Review;
  expect(() => expectedWorkerArtifactState(incomplete, scenario)).toThrow(
    "Incomplete worker artifact snapshot inventory",
  );
});
