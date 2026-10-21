import { it, expect } from "vitest";
import {
  AuditDefaultFixture,
  AUDIT_DEFAULT_IDS,
  AUDIT_DEFAULT_TIME,
} from "./audit-default-fixture.js";
it("supplies only absent AuditEvent defaults while preserving explicit and business input", async () => {
  const fixture = new AuditDefaultFixture();
  const data = {
    actorId: "g1-user-a-only",
    action: "fixture.audit",
    subjectType: "review",
    subjectId: "g1-review-1",
    detailsJson: '{"public":"fixture"}',
    platformVersion: "native-platform-stamp",
  };
  const args = { data, select: { id: true } };
  let calls = 0;
  const result = (await fixture.query("AuditEvent", "create", args, async (prepared) => {
    calls++;
    return prepared;
  })) as { data: Record<string, unknown>; select: unknown };
  expect(calls).toBe(1);
  expect(args).toEqual({ data, select: { id: true } });
  expect(Object.keys(data)).not.toContain("id");
  expect(result.select).toBe(args.select);
  expect(result.data).toEqual({
    ...data,
    id: AUDIT_DEFAULT_IDS[0],
    createdAt: new Date(AUDIT_DEFAULT_TIME),
  });
  const explicit = {
    data: { ...data, id: "g1-explicit-audit", createdAt: new Date("2001-01-01T00:00:00.000Z") },
  };
  expect(await fixture.query("AuditEvent", "create", explicit, async (actual) => actual)).toBe(
    explicit,
  );
  expect(fixture.trace.every((row) => row.queryCalls === 1)).toBe(true);
});
it("preserves query return and exact native thrown object without retry", async () => {
  const fixture = new AuditDefaultFixture();
  const failure = { native: "error-control" };
  let calls = 0;
  await expect(
    fixture.query("AuditEvent", "create", { data: { action: "fixture.audit" } }, async () => {
      calls++;
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(calls).toBe(1);
  const args = { where: { id: "g1-audit" }, data: { subjectId: "explicit-update" } };
  expect(await fixture.query("AuditEvent", "update", args, async (value) => value)).toBe(args);
});
it("refuses unknown, nested, bulk and upsert creates before querying", async () => {
  const fixture = new AuditDefaultFixture();
  let calls = 0;
  const query = async () => {
    calls++;
    return null;
  };
  for (const [model, operation, args] of [
    ["Review", "create", { data: { slug: "not-written" } }],
    ["AuditEvent", "createMany", { data: [] }],
    ["AuditEvent", "createManyAndReturn", { data: [] }],
    ["AuditEvent", "upsert", { where: { id: "x" }, create: { action: "x" }, update: {} }],
    ["AuditEvent", "create", { data: { actor: { create: { githubLogin: "not-written" } } } }],
    ["User", "update", { data: { notifications: { create: { kind: "not-written" } } } }],
  ] as const)
    await expect(fixture.query(model, operation, args, query)).rejects.toThrow(
      /refused|Unsupported/u,
    );
  expect(calls).toBe(0);
});
it("preserves explicit metadata independently and refuses exhausted/ambiguous fixtures", () => {
  const f = new AuditDefaultFixture();
  const first = f.prepare("AuditEvent", "create", { data: { id: "explicit-id" } }) as {
    data: Record<string, unknown>;
  };
  expect(first.data.id).toBe("explicit-id");
  expect(first.data.createdAt).toEqual(new Date(AUDIT_DEFAULT_TIME));
  const second = f.prepare("AuditEvent", "create", {
    data: { createdAt: "2002-02-02T00:00:00.000Z" },
  }) as { data: Record<string, unknown> };
  expect(second.data.id).toBe(AUDIT_DEFAULT_IDS[1]);
  expect(second.data.createdAt).toBe("2002-02-02T00:00:00.000Z");
  f.prepare("AuditEvent", "create", { data: {} });
  expect(() => f.prepare("AuditEvent", "create", { data: {} })).toThrow("exhausted");
  expect(() =>
    new AuditDefaultFixture().prepare("AuditEvent", "create", { data: { id: undefined } }),
  ).toThrow("explicit");
});
