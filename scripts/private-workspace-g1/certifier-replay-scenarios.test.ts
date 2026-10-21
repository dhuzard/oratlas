import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import {
  createCertificationRunSchema,
  submitCertificationResultSchema,
  certificationRunTerminalTransitionSchema,
  certificationLifecycleRequestSchema,
  issueCertifierCredentialSchema,
} from "../../packages/contracts/src/certification.js";
import { publicationVersionPacketSchema } from "../../packages/contracts/src/publication-version-packets.js";
import {
  CERTIFIER_INPUTS,
  certifierReplayScenarios,
  CERTIFIER_REPLAY_PROGRAM,
  CERTIFIER_REPLAY_SETUP_UPDATES,
} from "./certifier-replay-scenarios.js";
import {
  expectedCertifierReplayState,
  certifierReplayStateProblems,
  certifierReplayCapabilityProblems,
} from "./certifier-replay-state.js";
import { PRINCIPAL_LABELS, sha256Text } from "./principals.js";
import { programProblems } from "./scenarios.js";
import { workerCredential, workerAuthorityProblems } from "./worker-authority.js";
import { workerOutputProblems } from "./worker-capture-safety.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const native = JSON.parse(fixture("certifier-replay-native.json")),
  sql = fixture("certifier-replay-fixtures.sql");
const rows = [
  ...sql.matchAll(
    /INSERT INTO "(\w+)" SELECT \(jsonb_populate_record\(NULL::"\w+", '((?:''|[^'])*)'::jsonb\)\)\.\*;/gu,
  ),
].map((m) => ({ table: m[1]!, row: JSON.parse(m[2]!.replaceAll("''", "'")) }));
it("requires300 native credential/role-independent replays and preserves201 lifecycle semantics", () => {
  const scenarios = certifierReplayScenarios();
  expect(scenarios).toHaveLength(300);
  expect(programProblems(scenarios)).toEqual([]);
  for (const principal of PRINCIPAL_LABELS) {
    const own = scenarios.filter((s) => s.principal === principal);
    expect(own).toHaveLength(50);
    const successes = own.filter((s) => s.expect.status < 300);
    expect(successes).toHaveLength(4);
    expect(new Set(successes.map((s) => s.route)).size).toBe(4);
    expect(
      successes.every((s) =>
        s.expect.json?.some((c) => c.pointer === "/replayed" && "equals" in c && c.equals === true),
      ),
    ).toBe(true);
    expect(successes.find((s) => s.route.endsWith("lifecycle"))?.expect.status).toBe(201);
    expect(
      own.filter(
        (s) =>
          s.workerAuthority.credential === "wrong-owner-submit" && s.credentialStamp === "other",
      ),
    ).toHaveLength(4);
    expect(
      own.filter((s) => s.id.includes("read-only") && s.credentialStamp === null),
    ).toHaveLength(4);
    expect(
      own.filter((s) => s.id.includes("unsupported-media") && s.credentialStamp === null),
    ).toHaveLength(4);
    for (const scenario of own)
      expect(workerAuthorityProblems(scenario.workerAuthority)).toEqual([]);
  }
  expect(CERTIFIER_REPLAY_PROGRAM.spec).toBe("certifier-replays.g1.spec.ts");
  expect(CERTIFIER_REPLAY_PROGRAM.fixtures).toEqual([
    "fixtures/worker-source-fixtures.sql",
    "fixtures/worker-fixtures.sql",
    "fixtures/certifier-replay-fixtures.sql",
  ]);
  expect(Object.values(CERTIFIER_REPLAY_PROGRAM.addedRows).reduce((a, b) => a + b, 0)).toBe(41);
});
it("retains exact native terminal history/audits and substitutes only non-bearer fixture credential digests", () => {
  expect(rows).toHaveLength(4);
  expect(
    Object.fromEntries(
      [...new Set(rows.map((r) => r.table))].map((table) => [
        table,
        rows.filter((r) => r.table === table).length,
      ]),
    ),
  ).toEqual(CERTIFIER_INPUTS.addedRows);
  expect(rows.filter((r) => r.table === "CertificationRun").map((r) => r.row)).toEqual([
    native.terminalRun,
  ]);
  expect(rows.filter((r) => r.table === "AuditEvent").map((r) => r.row)).toEqual(native.audit);
  const credential = workerCredential("certifier", "wrong-owner-submit");
  expect(rows.find((r) => r.table === "CertifierCredential")!.row).toEqual({
    ...native.otherCredential,
    tokenPrefix: credential.tokenPrefix,
    tokenHash: credential.tokenHash,
  });
  expect(
    issueCertifierCredentialSchema.parse({
      label: native.otherCredential.label,
      scopes: JSON.parse(native.otherCredential.scopesJson),
      expiresAt: native.otherCredential.expiresAt,
    }).scopes,
  ).toEqual(["certification:submit"]);
  expect(native.otherCredential.certifierId).toBe("g1-worker-certifier-other");
  expect(native.otherCredential.lastUsedAt).toBeNull();
  expect(native.createdRun.status).toBe("running");
  expect(native.createdRun.completedAt).toBeNull();
  expect(native.terminalRun).toEqual({
    ...native.createdRun,
    status: "failed",
    completedAt: "2026-03-31T23:58:00.000Z",
    terminalReason: CERTIFIER_INPUTS.requests.transition.reason,
  });
  const transitionAudit = native.audit.find(
    (row: { action: string }) => row.action === "certification.run-failed",
  );
  expect(transitionAudit.subjectType).toBe("certification-run");
  expect(transitionAudit.subjectId).toBe(native.terminalRun.id);
  expect(transitionAudit.idempotencyKey).toBe(`certification-run:${native.terminalRun.id}:failed`);
  expect(JSON.parse(transitionAudit.detailsJson)).toEqual({
    certifierId: "g1-certifier-ora",
    credentialId: "g1-worker-certifier-submit-only",
    reason: CERTIFIER_INPUTS.requests.transition.reason,
  });
  const issuanceAudit = native.audit.find(
    (row: { action: string }) => row.action === "certification.credential-issued",
  );
  expect(issuanceAudit.subjectId).toBe(native.otherCredential.id);
  expect(issuanceAudit.actorId).toBe("g1-user-admin");
  expect(JSON.parse(issuanceAudit.detailsJson).scopes).toEqual(["certification:submit"]);
  expect(CERTIFIER_REPLAY_SETUP_UPDATES).toEqual([
    {
      table: "CertifierCredential",
      id: "g1-worker-certifier-submit-only",
      fields: { lastUsedAt: native.primaryCredential.lastUsedAt },
    },
  ]);
  expect(sql).toContain(
    `UPDATE "CertifierCredential" SET "lastUsedAt"='${native.primaryCredential.lastUsedAt}'`,
  );
  expect(sql).not.toMatch(
    /\b(?:ALTER|GRANT|DROP|TRUNCATE|DISABLE TRIGGER|session_replication_role)\b/u,
  );
  expect(
    workerOutputProblems(
      sql + fixture("certifier-replay-native.json") + fixture("certifier-replay-inputs.json"),
    ),
  ).toEqual([]);
});
it("binds positive replay inputs to native contracts and exact immutable packet/result/lifecycle rows", () => {
  const create = createCertificationRunSchema.parse(CERTIFIER_INPUTS.requests.create),
    result = submitCertificationResultSchema.parse(CERTIFIER_INPUTS.requests.result),
    transition = certificationRunTerminalTransitionSchema.parse(
      CERTIFIER_INPUTS.requests.transition,
    ),
    lifecycle = certificationLifecycleRequestSchema.parse(CERTIFIER_INPUTS.requests.lifecycle);
  expect(create).toMatchObject({
    publicationVersionId: native.existingRun.publicationVersionId,
    certificationProtocolId: native.existingRun.protocolId,
    assessmentMode: native.existingRun.assessmentMode,
    idempotencyKey: native.existingRun.idempotencyKey,
  });
  for (const run of [native.createdRun, native.terminalRun, native.existingRun]) {
    const packet = publicationVersionPacketSchema.parse(JSON.parse(run.inputPacketJson));
    expect(run.inputPacketSha256).toBe(sha256Text(canonicalJson(packet)));
    const { sha256, ...unhashed } = packet;
    expect(sha256).toBe(sha256Text(canonicalJson(unhashed)));
    expect(run.packetSchemaVersion).toBe(packet.schemaVersion);
    expect(packet.occurrences[0]?.canonicalBinding).toBeNull();
  }
  expect(canonicalJson(result)).toBe(native.result.resultJson);
  expect(sha256Text(canonicalJson(result))).toBe(native.result.resultSha256);
  expect(result.packetSha256).toBe(native.existingRun.inputPacketSha256);
  expect(result.outcome).toBe("inconclusive");
  expect(transition.status).toBe(native.terminalRun.status);
  expect(transition.reason).toBe(native.terminalRun.terminalReason);
  expect(lifecycle).toEqual({ kind: native.withdrawn.kind, reason: native.withdrawn.reason });
  expect(native.withdrawn.actorCertifierId).toBe(native.result.certifierId);
});
it("rejects same-count changes to any field outside the selected certifier auth stamp", () => {
  const state: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(
    PUBLIC_SELECT_TABLES.map((table) => [table, []]),
  );
  state.CertifierCredential = [
    {
      id: "g1-worker-certifier-submit-only",
      lastUsedAt: null,
      tokenHash: "frozen",
      scopesJson: '["certification:submit"]',
    },
    {
      id: CERTIFIER_INPUTS.otherCredentialId,
      lastUsedAt: null,
      tokenHash: "other",
      scopesJson: '["certification:submit"]',
    },
  ];
  state.CertificationRun = [{ id: "known", status: "failed", terminalReason: "frozen" }];
  const scenario = { credentialStamp: "primary" as const };
  const after = expectedCertifierReplayState(state, scenario);
  expect(certifierReplayStateProblems(state, after, scenario)).toEqual([]);
  for (const changed of [
    {
      ...after,
      CertificationRun: [{ id: "known", status: "completed", terminalReason: "frozen" }],
    },
    {
      ...after,
      CertifierCredential: [
        { ...after.CertifierCredential![0], scopesJson: '["certification:read"]' },
        after.CertifierCredential![1]!,
      ],
    },
    { ...after, AuditEvent: [{ id: "unexpected" }] },
  ])
    expect(certifierReplayStateProblems(state, changed, scenario)).toEqual([
      "Unexpected certifier row or field delta",
    ]);
  expect(expectedCertifierReplayState(state, { credentialStamp: null })).toEqual(state);
  const incomplete = { ...state };
  delete incomplete.User;
  expect(() => expectedCertifierReplayState(incomplete, scenario)).toThrow(
    "Incomplete certifier snapshot inventory",
  );
});

it("refuses Cookie components, decoded-body worker capabilities and state leaks before either output can persist", () => {
  const record = {
    headers: [] as Array<readonly [string, string]>,
    setCookie: [] as string[],
    bodyBase64: Buffer.from("{}").toString("base64"),
  };
  const component = "synthetic-session-signature-canary";
  expect(certifierReplayCapabilityProblems([record], { safe: true }, [component])).toEqual([]);
  for (const secret of [
    component,
    workerCredential("certifier", "wrong-owner-submit").token,
    workerCredential("certifier", "wrong-owner-submit").token.split(".")[1]!,
  ]) {
    expect(
      certifierReplayCapabilityProblems(
        [
          {
            ...record,
            bodyBase64: Buffer.from(JSON.stringify({ value: secret })).toString("base64"),
          },
        ],
        {},
        [component],
      ),
    ).toEqual(["Certifier capability disclosure refused"]);
    expect(
      certifierReplayCapabilityProblems([record], { nested: { value: secret } }, [component]),
    ).toEqual(["Certifier capability disclosure refused"]);
  }
  expect(
    certifierReplayCapabilityProblems([{ ...record, setCookie: [component] }], {}, [component]),
  ).toEqual(["Unexpected certifier cookie or redirect refused"]);
  expect(
    certifierReplayCapabilityProblems(
      [{ ...record, headers: [["location", "https://synthetic.example"]] }],
      {},
      [component],
    ),
  ).toEqual(["Unexpected certifier cookie or redirect refused"]);
});
