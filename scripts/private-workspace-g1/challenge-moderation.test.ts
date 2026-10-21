import { expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { G1_FIXED_CLOCK } from "./capture.js";
import { PRINCIPAL_LABELS } from "./principals.js";
import { programProblems } from "./scenarios.js";
import { ChallengeModerationInputFixture } from "./challenge-moderation-audit.js";
import {
  CHALLENGE_MODERATION_TARGETS as targets,
  CHALLENGE_MODERATION_SCENARIOS as scenarios,
  CHALLENGE_MODERATION_EXTRA_COLUMNS as columns,
  CHALLENGE_MODERATION_AUDIT_IDS as ids,
} from "./challenge-moderation-scenarios.js";
function update(index: number) {
  const t = targets[index]!;
  return {
    where: { id: t.id, contentStatus: "visible", contentRevision: 0 },
    data: {
      contentStatus: "removed",
      contentRevision: 1,
      removedAt: new Date(G1_FIXED_CLOCK),
      removedById: t.actorId,
      removedByRoleSnapshot: t.role,
    },
  };
}
function audit(index: number) {
  const t = targets[index]!;
  return {
    data: {
      actorId: t.actorId,
      action: "challenge.content-removed",
      subjectType: "challenge",
      subjectId: t.id,
      detailsJson: canonicalJson({ contentHash: t.contentHash, contentRevision: 1 }),
    },
  };
}
it("declares filer/editor/admin successes over unchanged native terminal targets and all principals", () => {
  expect(programProblems(scenarios)).toEqual([]);
  expect(scenarios).toHaveLength(76);
  expect(
    scenarios.filter((s) => s.method === "POST" && s.expect.status === 200).map((s) => s.principal),
  ).toEqual(["A+B", "EDITOR", "ADMIN"]);
  for (const principal of PRINCIPAL_LABELS)
    expect(scenarios.some((s) => s.method === "POST" && s.principal === principal)).toBe(true);
  expect(columns).toEqual([
    "contentStatus",
    "contentRevision",
    "removedAt",
    "removedById",
    "removedByRoleSnapshot",
    "updatedAt",
  ]);
});
it("injects only three absent update timestamps and three exact audit metadata tuples without mutating inputs", async () => {
  const f = new ChallengeModerationInputFixture();
  let calls = 0;
  for (let i = 0; i < 3; i++) {
    const u = update(i),
      original = structuredClone(u);
    const result = await f.query("Challenge", "updateMany", u, async (args) => {
      calls++;
      return args;
    });
    expect(u).toEqual(original);
    expect(result).toEqual({ ...u, data: { ...u.data, updatedAt: new Date(G1_FIXED_CLOCK) } });
    const a = audit(i);
    const appended = await f.query("AuditEvent", "create", a, async (args) => {
      calls++;
      return args;
    });
    expect(appended).toEqual({
      data: { ...a.data, id: ids[i], createdAt: new Date(G1_FIXED_CLOCK) },
    });
  }
  expect(calls).toBe(6);
  expect(f.updateTrace).toEqual(targets.map((t) => ({ target: t.id, injected: ["updatedAt"] })));
  expect(f.trace.every((t) => t.queryCalls === 1)).toBe(true);
  await expect(
    f.query("Challenge", "updateMany", update(0), async () => {
      calls++;
    }),
  ).rejects.toThrow(/input refused/);
  expect(calls).toBe(6);
});
it("refuses explicit metadata, wrong target/actor/field, nested/bulk writes and out-of-order audit before delegation", async () => {
  const u = update(0);
  const negatives: Array<[string, string, unknown]> = [
    ["Challenge", "updateMany", { ...u, data: { ...u.data, updatedAt: undefined } }],
    ["Challenge", "updateMany", { ...u, data: { ...u.data, updatedAt: new Date(G1_FIXED_CLOCK) } }],
    ["Challenge", "updateMany", { ...u, where: { ...u.where, id: targets[1]!.id } }],
    ["Challenge", "updateMany", { ...u, data: { ...u.data, removedById: "g1-user-b-only" } }],
    ["Challenge", "updateMany", { ...u, data: { ...u.data, status: "open" } }],
    [
      "Challenge",
      "updateMany",
      { ...u, data: { ...u.data, response: { create: { body: "extra" } } } },
    ],
    ["Challenge", "update", u],
    ["Challenge", "create", u],
    ["Challenge", "deleteMany", u],
    ["AuditEvent", "create", audit(0)],
    ["ChallengeResponse", "create", { data: {} }],
  ];
  for (const [model, operation, args] of negatives) {
    let calls = 0;
    const f = new ChallengeModerationInputFixture();
    await expect(
      f.query(model, operation, args, async () => {
        calls++;
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  }
  for (const data of [
    { ...audit(0).data, id: undefined },
    { ...audit(0).data, createdAt: new Date() },
    { ...audit(0).data, subjectId: targets[1]!.id },
    { ...audit(0).data, extra: undefined },
  ]) {
    const f = new ChallengeModerationInputFixture();
    await f.query("Challenge", "updateMany", u, async () => ({ count: 1 }));
    let calls = 0;
    await expect(
      f.query("AuditEvent", "create", { data }, async () => {
        calls++;
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  }
});
it("delegates native errors exactly once without retry, rewriting or swallowing them", async () => {
  const f = new ChallengeModerationInputFixture();
  const nativeError = new Error("synthetic native constraint sentinel");
  let calls = 0;
  await expect(
    f.query("Challenge", "updateMany", update(0), async () => {
      calls++;
      throw nativeError;
    }),
  ).rejects.toBe(nativeError);
  expect(calls).toBe(1);
  expect(f.trace[0]!.queryCalls).toBe(1);
});
