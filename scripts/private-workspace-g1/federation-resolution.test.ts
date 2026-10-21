import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import {
  parseCoarNotifyActivity,
  federationResolutionSchema,
} from "../../packages/federation/src/index.js";
import { PLATFORM_VERSION } from "../../packages/config/src/index.js";
import { FederationResolutionAuditFixture } from "./federation-resolution-audit.js";
import {
  FEDERATION_RESOLUTION_NATIVE,
  FEDERATION_RESOLUTION_SCENARIOS,
  FEDERATION_RESOLUTION_TARGETS,
  FEDERATION_RESOLUTION_EXTRA_COLUMNS,
} from "./federation-resolution-scenarios.js";
import { programProblems } from "./scenarios.js";
import { PRINCIPAL_LABELS, principalSessionProblems } from "./principals.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import { AUDIT_DEFAULT_IDS, AUDIT_DEFAULT_TIME } from "./audit-default-fixture.js";
it("declares populated existing-row mutations with six native-cookie cases and exact public observers", () => {
  expect(programProblems(FEDERATION_RESOLUTION_SCENARIOS)).toEqual([]);
  expect(FEDERATION_RESOLUTION_SCENARIOS).toHaveLength(88);
  for (const p of PRINCIPAL_LABELS)
    expect(
      FEDERATION_RESOLUTION_SCENARIOS.some((s) => s.method === "POST" && s.principal === p),
    ).toBe(true);
  expect(
    FEDERATION_RESOLUTION_SCENARIOS.flatMap((s) =>
      principalSessionProblems(s.principal, s.session.case, s.session),
    ),
  ).toEqual([]);
  expect(
    FEDERATION_RESOLUTION_SCENARIOS.filter(
      (s) => s.method === "POST" && s.expect.status === 200,
    ).map((s) => s.principal),
  ).toEqual(["EDITOR", "ADMIN"]);
  expect(FEDERATION_RESOLUTION_SCENARIOS.filter((s) => s.method === "GET")).toHaveLength(18);
  expect(
    FEDERATION_RESOLUTION_SCENARIOS.reduce<Record<string, number>>(
      (r, s) => ((r[s.expect.status] = (r[s.expect.status] ?? 0) + 1), r),
      {},
    ),
  ).toEqual({ 200: 14, 400: 17, 401: 10, 403: 33, 404: 8, 409: 6 });
  for (const target of FEDERATION_RESOLUTION_TARGETS) {
    federationResolutionSchema.parse({ decision: target.decision, note: target.note });
    const first = FEDERATION_RESOLUTION_SCENARIOS.find(
      (s) => s.id === `federation-resolve-pending-${target.principal}`,
    )!;
    const repeat = FEDERATION_RESOLUTION_SCENARIOS.find(
      (s) => s.id === `federation-resolve-replay-${target.principal}`,
    )!;
    expect(repeat.body).toEqual(first.body);
    expect(repeat.path).toBe(first.path);
    expect(repeat.expect.status).toBe(409);
    expect(repeat.headers).toEqual({ ...first.headers, "x-g1-observation": "exact-replay" });
  }
});
it("retains actual native receive rows with schema-valid immutable source bytes, hashes and audit bindings", () => {
  const n = FEDERATION_RESOLUTION_NATIVE;
  expect(n.outbound).toBe(0);
  expect(n.notifications).toHaveLength(2);
  expect(n.audits).toHaveLength(2);
  const sql = readFileSync(
    new URL("./fixtures/federation-resolution-fixtures.sql", import.meta.url),
    "utf8",
  );
  const rows = [
    ...sql.matchAll(
      /jsonb_populate_record\(NULL::public\."(FederationNotification|AuditEvent)",\s*'((?:[^']|'')*)'::jsonb\)/gu,
    ),
  ].map((m) => ({ table: m[1], row: JSON.parse(m[2]!.replaceAll("''", "'")) }));
  expect(rows).toEqual([
    ...n.notifications.map((row) => ({ table: "FederationNotification", row })),
    ...n.audits.map((row) => ({ table: "AuditEvent", row })),
  ]);
  for (const [i, input] of n.inputs.entries()) {
    const parsed = parseCoarNotifyActivity(input),
      receipt = n.receipts[i]!;
    const row = n.notifications.find((r) => r.id === receipt.id)!;
    expect(parsed.pattern).toBe("request-review");
    expect(row.status).toBe("pending");
    expect(row.direction).toBe("inbound");
    expect(row.activityId).toBe(parsed.activityId);
    expect(row.payloadJson).toBe(canonicalJson(parsed.payload));
    expect(row.payloadHash).toBe(
      createHash("sha256").update(String(row.payloadJson)).digest("hex"),
    );
    expect(n.audits.find((a) => a.subjectId === row.id)).toMatchObject({
      action: "federation.notification-received",
      subjectType: "federation-notification",
      idempotencyKey: `federation.receive:${parsed.activityId}`,
      platformVersion: PLATFORM_VERSION,
    });
  }
  expect(FEDERATION_RESOLUTION_EXTRA_COLUMNS).toEqual([
    "status",
    "resolutionNote",
    "resolvedById",
    "resolvedAt",
  ]);
  expect(PUBLIC_SELECT_TABLES).toContain("FederationNotification");
});
const audit = (i: number) => {
  const t = FEDERATION_RESOLUTION_TARGETS[i]!;
  return {
    data: {
      actorId: t.actorId,
      action: "federation.notification-resolved",
      subjectType: "federation-notification",
      subjectId: t.id,
      idempotencyKey: `federation.resolve:${t.id}`,
      detailsJson: canonicalJson({ decision: t.decision, note: t.note }),
    },
  };
};
it("supplies only two bound absent audit metadata slots and delegates each unchanged business create once", async () => {
  const fixture = new FederationResolutionAuditFixture();
  let calls = 0;
  for (let i = 0; i < 2; i++) {
    const args = audit(i);
    const observed = await fixture.query("AuditEvent", "create", args, async (prepared) => {
      calls++;
      return prepared;
    });
    expect(observed).toEqual({
      data: { ...args.data, id: AUDIT_DEFAULT_IDS[i], createdAt: new Date(AUDIT_DEFAULT_TIME) },
    });
    expect(args).toEqual(audit(i));
  }
  await expect(
    fixture.query("AuditEvent", "create", audit(0), async () => {
      calls++;
    }),
  ).rejects.toThrow("Federation audit input refused");
  expect(calls).toBe(2);
  expect(fixture.trace.every((t) => t.queryCalls === 1)).toBe(true);
});
it("refuses unexpected actor/action/target/payload and other/nested/bulk creates before native delegation", async () => {
  const args = audit(0);
  let calls = 0;
  const query = async () => {
    calls++;
  };
  for (const bad of [
    { ...args, data: { ...args.data, actorId: "g1-user-admin" } },
    { ...args, data: { ...args.data, action: "federation.notification-received" } },
    { ...args, data: { ...args.data, subjectId: "unknown" } },
    { ...args, data: { ...args.data, detailsJson: "{}" } },
    { ...args, data: { ...args.data, id: "explicit-id" } },
    { ...args, data: { ...args.data, platformVersion: "foreign" } },
  ])
    await expect(
      new FederationResolutionAuditFixture().query("AuditEvent", "create", bad, query),
    ).rejects.toThrow();
  for (const [model, op, data] of [
    ["User", "create", args],
    ["AuditEvent", "createMany", args],
    ["AuditEvent", "upsert", args],
    ["User", "update", { data: { audit: { create: args.data } } }],
  ] as const)
    await expect(
      new FederationResolutionAuditFixture().query(model, op, data, query),
    ).rejects.toThrow();
  expect(calls).toBe(0);
});
