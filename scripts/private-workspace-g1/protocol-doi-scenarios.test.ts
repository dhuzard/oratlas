import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { doiValidationReportSchema } from "../../packages/contracts/src/doi.js";
import {
  protocolSnapshotInputSchema,
  normalizedProtocolSchema,
  observedReviewSchema,
  adaptClinicalTrialsGovStudy,
  compareProtocolToReview,
} from "../../packages/protocols/src/index.js";
import {
  PROTOCOL_POST_INPUTS,
  PROTOCOL_DOI_PROGRAM,
  protocolDoiScenarios,
} from "./protocol-doi-scenarios.js";
import {
  protocolDoiStateProblems,
  protocolDoiOutputProblems,
  assertProtocolDoiOutputSafe,
} from "./protocol-doi-state.js";
import { PRINCIPAL_LABELS, NEGATIVE_SESSIONS, sha256Text } from "./principals.js";
import { programProblems } from "./scenarios.js";
import { PUBLIC_SELECT_TABLES, PUBLIC_COLUMN_UPDATE_GRANTS } from "./sql.js";
import { workerCredential } from "./worker-authority.js";
import { workerOutputProblems } from "./worker-capture-safety.js";
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const native = JSON.parse(fixture("protocol-post-native.json")),
  sql = fixture("protocol-post-fixtures.sql");
const rows = [
  ...sql.matchAll(
    /INSERT INTO "(\w+)" SELECT \(jsonb_populate_record\(NULL::"\w+", '((?:''|[^'])*)'::jsonb\)\)\.\*;/gu,
  ),
].map((m) => ({ table: m[1]!, row: JSON.parse(m[2]!.replaceAll("''", "'")) }));
it("declares two meaningful native POST methods with six cookies and honest invalid-cookie fallback", () => {
  const scenarios = protocolDoiScenarios();
  expect(scenarios).toHaveLength(110);
  expect(programProblems(scenarios)).toEqual([]);
  expect(new Set(scenarios.map((s) => s.route))).toEqual(
    new Set(["api/protocols/snapshots", "api/validate-doi"]),
  );
  for (const principal of PRINCIPAL_LABELS) {
    const own = scenarios.filter(
      (s) =>
        s.principal === principal &&
        s.session.case !== "malformed" &&
        s.session.case !== "signed-expired" &&
        s.session.case !== "signed-missing-user" &&
        s.session.case !== "tampered",
    );
    expect(own).toHaveLength(17);
    expect(
      own.filter((s) => s.route === "api/validate-doi" && s.expect.status === 200),
    ).toHaveLength(4);
    expect(
      own.filter((s) => s.route === "api/protocols/snapshots" && s.expect.status === 200),
    ).toHaveLength(principal === "EDITOR" || principal === "ADMIN" ? 1 : 0);
  }
  for (const session of NEGATIVE_SESSIONS) {
    expect(
      scenarios.find((s) => s.id === `protocol-post-invalid-cookie-${session.case}`)?.expect.status,
    ).toBe(401);
    expect(
      scenarios.find((s) => s.id === `doi-post-invalid-cookie-${session.case}`)?.expect.status,
    ).toBe(200);
  }
  expect(PROTOCOL_DOI_PROGRAM.spec).toBe("protocol-doi.g1.spec.ts");
  expect(PROTOCOL_DOI_PROGRAM.fixtures).toEqual(["fixtures/protocol-post-fixtures.sql"]);
  expect(Object.values(PROTOCOL_DOI_PROGRAM.addedRows).reduce((a, b) => a + b, 0)).toBe(5);
  expect(
    PUBLIC_COLUMN_UPDATE_GRANTS.some((grant) => String(grant.table) === "ProtocolDriftProposal"),
  ).toBe(false);
});
it("stores exact native rows without hash/ID/time substitutions and counts all bootstrap effects", () => {
  expect(rows).toHaveLength(5);
  expect(
    Object.fromEntries(
      [...new Set(rows.map((r) => r.table))].map((table) => [
        table,
        rows.filter((r) => r.table === table).length,
      ]),
    ),
  ).toEqual(PROTOCOL_POST_INPUTS.addedRows);
  expect(rows.filter((r) => r.table === "ProtocolSnapshot").map((r) => r.row)).toEqual([
    native.snapshot,
  ]);
  expect(rows.filter((r) => r.table === "ProtocolDriftProposal").map((r) => r.row)).toEqual(
    native.proposals,
  );
  expect(rows.filter((r) => r.table === "AuditEvent").map((r) => r.row)).toEqual(native.audits);
  expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|ALTER|DROP|GRANT|TRUNCATE|DISABLE TRIGGER)\b/u);
  expect(
    workerOutputProblems(
      sql + fixture("protocol-post-native.json") + fixture("protocol-post-inputs.json"),
    ),
  ).toEqual([]);
  expect(native.closedReplay).toEqual({ code: "conflict", message: "Proposal is no longer open." });
  expect(native.outbound).toBe(0);
});
it("reconstructs snapshot identity/normalization/proposals from current contracts and exact declared source", () => {
  const input = protocolSnapshotInputSchema.parse(PROTOCOL_POST_INPUTS.input);
  expect(input).toEqual(native.input);
  const normalized = adaptClinicalTrialsGovStudy(input.payload, {
    sourceUrl: input.sourceUrl,
    sourceVersion: input.sourceVersion,
    fetchedAt: input.fetchedAt,
  });
  expect(normalizedProtocolSchema.parse(JSON.parse(native.snapshot.normalizedJson))).toEqual(
    normalized,
  );
  expect(native.snapshot.rawJson).toBe(canonicalJson(input.payload));
  const hash = sha256Text(canonicalJson({ payload: input.payload, osfQuestions: null }));
  expect(native.snapshot.contentHash).toBe(hash);
  expect(native.snapshot.id).toBe(
    `ps_${sha256Text(canonicalJson({ targetKey: native.snapshot.targetKey, registry: normalized.source.registry, sourceId: normalized.source.sourceId, sourceVersion: normalized.source.sourceVersion, contentHash: hash }))}`,
  );
  const proposals = compareProtocolToReview(
    normalized,
    observedReviewSchema.parse(JSON.parse(native.snapshot.observedJson)),
  );
  expect(proposals).toHaveLength(2);
  for (const row of native.initialProposals) {
    const proposal = proposals.find((p) => p.id === row.id)!;
    expect(proposal).toBeDefined();
    expect(row).toMatchObject({
      snapshotId: native.snapshot.id,
      status: "open",
      category: proposal.category,
      kind: proposal.kind,
      rationale: proposal.rationale,
      comparatorVersion: proposal.comparatorVersion,
      registeredJson: canonicalJson(proposal.registered),
      observedJson: canonicalJson(proposal.observed),
    });
  }
  expect(native.proposals).toEqual(
    native.initialProposals.map((row: Record<string, unknown>, index: number) =>
      index === 0
        ? {
            ...row,
            status: native.resolution.resolution,
            resolvedById: "g1-user-admin",
            resolutionNote: native.resolution.note,
            resolvedAt: "2026-03-31T23:56:00.000Z",
          }
        : row,
    ),
  );
  const registered = native.audits.find(
    (r: { action: string }) => r.action === "protocol.snapshot-registered",
  );
  expect(registered.subjectId).toBe(native.snapshot.id);
  expect(registered.idempotencyKey).toBe(`protocol.snapshot-registered:${native.snapshot.id}`);
  expect(JSON.parse(registered.detailsJson)).toMatchObject({
    contentHash: hash,
    proposalsOpened: 2,
    sourceId: normalized.source.sourceId,
    sourceVersion: input.sourceVersion,
  });
  const resolved = native.audits.find(
    (r: { action: string }) => r.action === "protocol.proposal-resolved",
  );
  expect(resolved.subjectId).toBe(native.initialProposals[0].id);
  expect(JSON.parse(resolved.detailsJson)).toEqual({ resolution: native.resolution.resolution });
  expect(PROTOCOL_POST_INPUTS.replay).toEqual({
    ...native.first,
    idempotent: true,
    proposalsOpened: 0,
  });
});
it("retains truthful local DOI reports without claiming version/concept resolution or scientific confidence", () => {
  expect(PROTOCOL_POST_INPUTS.doi).toEqual(native.doi);
  for (const { request, report } of PROTOCOL_POST_INPUTS.doi) {
    const parsed = doiValidationReportSchema.parse(report);
    expect(parsed.input).toBe(request.doi);
    expect(parsed.confidence).toBe("none");
    expect(parsed.doiKind).toBe("unknown");
    expect(parsed.validatedAt).toBe("2026-04-01T00:00:00.000Z");
    expect(parsed.resolvedUrl).toBeUndefined();
    expect(parsed.isZenodo).toBe(false);
  }
  expect(
    PROTOCOL_POST_INPUTS.doi
      .slice(0, 2)
      .every((row) => row.report.status === "example-not-resolvable"),
  ).toBe(true);
  expect(PROTOCOL_POST_INPUTS.doi.slice(2).every((row) => row.report.status === "invalid")).toBe(
    true,
  );
  expect(
    (PROTOCOL_POST_INPUTS.doi[0]!.report.checks as Array<{ outcome: string }>)[1]!.outcome,
  ).toBe("skipped");
});
it("rejects same-count full-state mutations, partial scope and raw Cookie/worker leaks before output persistence", () => {
  const state: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(
    PUBLIC_SELECT_TABLES.map((table) => [table, []]),
  );
  state.User = [{ id: "synthetic", displayName: "unchanged" }];
  expect(protocolDoiStateProblems(state, structuredClone(state))).toEqual([]);
  expect(
    protocolDoiStateProblems(state, {
      ...state,
      User: [{ id: "synthetic", displayName: "changed" }],
    }),
  ).toEqual(["Unexpected protocol/DOI public row or field change"]);
  const incomplete = { ...state };
  delete incomplete.User;
  expect(protocolDoiStateProblems(state, incomplete)).toEqual([
    "Incomplete protocol/DOI state scope",
  ]);
  const record = {
      headers: [] as Array<readonly [string, string]>,
      setCookie: [] as string[],
      bodyBase64: Buffer.from("{}").toString("base64"),
    },
    canary = "synthetic-session-signature-component";
  expect(protocolDoiOutputProblems([record], state, [canary])).toEqual([]);
  // The existing malformed recipe is declared invalid public input, never a signed credential.
  expect(
    protocolDoiOutputProblems(
      [record],
      { session: { case: "malformed", value: "g1-malformed-session-value" } },
      ["oratlas_session=g1-malformed-session-value"],
    ),
  ).toEqual([]);
  for (const secret of [
    canary,
    workerCredential("certifier", "wrong-owner-submit").token,
    workerCredential("certifier", "wrong-owner-submit").token.split(".")[1]!,
  ]) {
    expect(
      protocolDoiOutputProblems(
        [
          {
            ...record,
            bodyBase64: Buffer.from(JSON.stringify({ value: secret })).toString("base64"),
          },
        ],
        {},
        [canary],
      ),
    ).toEqual(["Protocol/DOI capability disclosure refused"]);
    expect(protocolDoiOutputProblems([record], { nested: { value: secret } }, [canary])).toEqual([
      "Protocol/DOI capability disclosure refused",
    ]);
  }
  expect(protocolDoiOutputProblems([{ ...record, setCookie: [canary] }], {}, [canary])).toEqual([
    "Unexpected protocol/DOI cookie or redirect refused",
  ]);
});

it("refuses response/state cookie fragments before value-bearing diagnostics", () => {
  const secret = "synthetic-signed-cookie-component",
    record = {
      headers: [] as Array<readonly [string, string]>,
      setCookie: [] as string[],
      bodyBase64: Buffer.from(JSON.stringify({ confidence: secret })).toString("base64"),
    };
  for (const [records, state] of [
    [[record], {}],
    [[], { native: { rawJson: secret } }],
  ] as const) {
    let diagnosticReached = false,
      caught: unknown;
    try {
      assertProtocolDoiOutputSafe(records, state, [secret]);
      diagnosticReached = true;
      throw new Error(`value-bearing diagnostic: ${secret}`);
    } catch (error) {
      caught = error;
    }
    expect(diagnosticReached).toBe(false);
    expect(
      caught instanceof Error && caught.message === "Protocol/DOI capability output refused",
    ).toBe(true);
  }
  const source = readFileSync(new URL("./protocol-doi.g1.spec.ts", import.meta.url), "utf8");
  expect(source.indexOf("safe(state);")).toBeLessThan(source.indexOf("expect(validateCapture("));
  expect(source.indexOf("safe(before);")).toBeLessThan(source.indexOf("expect(native.rawJson)"));
  expect(source).toContain("safe({});\n    const after = await snapshot();\n    safe(after);");
});
