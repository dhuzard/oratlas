import { describe, it, expect } from "vitest";
import {
  proposalResolverScenarios,
  RESOLVER_COLUMN_UPDATES,
} from "./proposal-resolver-scenarios.js";
import {
  ResolverAuditFixture,
  RESOLVER_AUDIT_IDS,
  RESOLVER_AUDIT_INPUTS,
} from "./proposal-resolver-audit.js";
const targets = (["protocol", "monitoring"] as const).flatMap((kind) =>
  (["EDITOR", "ADMIN"] as const).map((actor) => ({ kind, id: `g1-${kind}-${actor}`, actor })),
);
describe("isolated resolver contract", () => {
  it("declares four distinct first successes and complete six-principal repeat/missing/integrity controls", () => {
    const s = proposalResolverScenarios(targets);
    expect(s).toHaveLength(132);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    for (const t of targets) {
      const rows = s.filter((x) => x.target === t);
      expect(rows.filter((x) => x.changes)).toHaveLength(1);
      expect(rows.filter((x) => x.changes)[0]?.principal).toBe(t.actor);
      expect(rows.filter((x) => x.id.includes("-repeat-")).map((x) => x.principal)).toHaveLength(6);
      expect(rows.filter((x) => x.expect.status === 200)).toHaveLength(1);
    }
    expect(RESOLVER_COLUMN_UPDATES.map((x) => x.columns)).toEqual(
      Array(2).fill(["status", "resolvedById", "resolutionNote", "resolvedAt"]),
    );
  });
  it("delegates native queries once, supplies only absent audit metadata and exhausts after four", async () => {
    const f = new ResolverAuditFixture();
    let calls = 0;
    for (const [index, id] of RESOLVER_AUDIT_IDS.entries()) {
      const out = await f.query(
        "AuditEvent",
        "create",
        { data: RESOLVER_AUDIT_INPUTS[index] },
        async (a) => {
          calls++;
          return a;
        },
      );
      expect(out).toEqual({
        data: { ...RESOLVER_AUDIT_INPUTS[index], id, createdAt: new Date("2026-04-01") },
      });
    }
    await expect(f.query("AuditEvent", "create", { data: {} }, async (a) => a)).rejects.toThrow(
      "exhausted",
    );
    expect(calls).toBe(4);
    expect(f.trace.every((x) => x.queryCalls === 1)).toBe(true);
  });
  it("refuses unexpected actor, subject, action, extra fields and native query duplication", async () => {
    for (const mutation of [
      { actorId: "unexpected" },
      { action: "unexpected" },
      { subjectId: "unexpected" },
      { extra: "unexpected" },
    ]) {
      const f = new ResolverAuditFixture();
      let called = 0;
      await expect(
        f.query(
          "AuditEvent",
          "create",
          { data: { ...RESOLVER_AUDIT_INPUTS[0], ...mutation } },
          async (a) => {
            called++;
            return a;
          },
        ),
      ).rejects.toThrow("actor/action/target");
      expect(called).toBe(0);
    }
    const f = new ResolverAuditFixture(),
      error = new Error("native");
    let called = 0;
    const result = await f
      .query("AuditEvent", "create", { data: RESOLVER_AUDIT_INPUTS[0] }, async () => {
        called++;
        throw error;
      })
      .catch((e) => e);
    expect(result).toBe(error);
    expect(called).toBe(1);
  });
  it("preserves explicit audit metadata and rejects unsupported domain/nested/bulk creates", async () => {
    const f = new ResolverAuditFixture(),
      args = {
        data: {
          ...RESOLVER_AUDIT_INPUTS[0],
          id: "explicit-input",
          createdAt: new Date("2026-03-31"),
        },
      };
    expect(await f.query("AuditEvent", "create", args, async (a) => a)).toBe(args);
    for (const [model, operation, a] of [
      ["User", "create", { data: {} }],
      ["AuditEvent", "createMany", { data: [] }],
      ["User", "update", { data: { relations: { create: {} } } }],
    ] as const)
      await expect(f.query(model, operation, a, async (a) => a)).rejects.toThrow();
  });
});
