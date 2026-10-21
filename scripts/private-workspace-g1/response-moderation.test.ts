import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { sha256Text, PRINCIPAL_LABELS, principalSessionProblems } from "./principals.js";
import { programProblems } from "./scenarios.js";
import { AUDIT_DEFAULT_TIME } from "./audit-default-fixture.js";
import { ResponseModerationAuditFixture } from "./response-moderation-audit.js";
import {
  RESPONSE_MODERATION_NATIVE as native,
  RESPONSE_MODERATION_TARGETS as targets,
  RESPONSE_MODERATION_SCENARIOS as scenarios,
  RESPONSE_MODERATION_AUDIT_IDS as ids,
  RESPONSE_MODERATION_EXTRA_COLUMNS as columns,
} from "./response-moderation-scenarios.js";
it("declares three populated native authority successes and all six real cookie principals", () => {
  expect(programProblems(scenarios)).toEqual([]);
  expect(scenarios).toHaveLength(76);
  expect(
    scenarios.filter((s) => s.method === "POST" && s.expect.status === 200).map((s) => s.principal),
  ).toEqual(["B-only", "EDITOR", "ADMIN"]);
  for (const p of PRINCIPAL_LABELS)
    expect(scenarios.some((s) => s.method === "POST" && s.principal === p)).toBe(true);
  expect(
    scenarios.flatMap((s) => principalSessionProblems(s.principal, s.session.case, s.session)),
  ).toEqual([]);
  expect(scenarios.filter((s) => s.method === "GET")).toHaveLength(6);
  expect(columns).toEqual([
    "contentStatus",
    "contentRevision",
    "removedAt",
    "removedById",
    "removedByRoleSnapshot",
  ]);
});
it("preserves exact native SQL rows and coherent terminal ledgers with linked contributor snapshots", () => {
  const sql = readFileSync(
    new URL("./fixtures/response-moderation-fixtures.sql", import.meta.url),
    "utf8",
  );
  const rows = [
    ...sql.matchAll(
      /jsonb_populate_record\(NULL::public\."([A-Za-z]+)",\s*'((?:[^']|'')*)'::jsonb\)/gu,
    ),
  ].map((m) => ({ table: m[1], row: JSON.parse(m[2]!.replaceAll("''", "'")) }));
  expect(rows).toEqual([
    { table: "Person", row: native.person },
    { table: "ReviewContributor", row: native.contributor },
    ...Object.entries(native.rows).flatMap(([table, rs]) => rs.map((row) => ({ table, row }))),
  ]);
  expect(Object.fromEntries(Object.entries(native.rows).map(([t, rs]) => [t, rs.length]))).toEqual({
    Challenge: 3,
    ChallengeResponse: 3,
    ChallengeTransition: 9,
    AuditEvent: 12,
  });
  expect(native.outbound).toBe(0);
  expect(native.person.githubLogin).toBe("g1-fixture-b-only");
  expect(native.contributor.personId).toBe(native.person.id);
  for (const target of targets) {
    const challenge = native.rows.Challenge!.find((r) => r.id === target.challengeId)!;
    const response = native.rows.ChallengeResponse!.find((r) => r.id === target.id)!;
    const ledger = native.rows
      .ChallengeTransition!.filter((r) => r.challengeId === challenge.id)
      .sort((a, b) => Number(a.revision) - Number(b.revision));
    expect(challenge).toMatchObject({
      status: "dismissed",
      revision: 2,
      activeChallengerSubjectKey: null,
    });
    expect(ledger.map((r) => [r.fromStatus, r.toStatus, r.revision])).toEqual([
      [null, "open", 0],
      ["open", "author-responded", 1],
      ["author-responded", "dismissed", 2],
    ]);
    expect(ledger.every((r) => r.filedContentHash === challenge.filedContentHash)).toBe(true);
    const filedFields = [
      "reviewVersionId",
      "subjectType",
      "subjectRefJson",
      "canonicalSubjectHash",
      "grounds",
      "body",
      "challengerId",
    ];
    expect(
      sha256Text(
        canonicalJson({
          schema: "oratlas/challenge-filed-content/1",
          ...Object.fromEntries(filedFields.map((k) => [k, challenge[k]])),
        }),
      ),
    ).toBe(challenge.filedContentHash);
    const nativeTimes = [
      challenge.createdAt,
      ledger[0]!.createdAt,
      response.createdAt,
      ledger[1]!.createdAt,
      ledger[2]!.createdAt,
      challenge.updatedAt,
    ].map((t) => Date.parse(String(t) + "Z"));
    expect(
      nativeTimes.every((t, i) => Number.isFinite(t) && (i === 0 || t >= nativeTimes[i - 1]!)),
    ).toBe(true);
    expect(ledger[1]!.responseContentHash).toBe(response.contentHash);
    expect(ledger[2]!.conflictOfInterestStatus).toBe("none-declared");
    expect(response).toMatchObject({
      challengeId: challenge.id,
      responderId: "g1-user-b-only",
      contributorPersonId: native.person.id,
      contentStatus: "visible",
      contentRevision: 0,
      removedAt: null,
      removedById: null,
    });
    expect(sha256Text(String(challenge.subjectRefJson))).toBe(challenge.canonicalSubjectHash);
    const fields = [
      "challengeId",
      "responderId",
      "responderRoleSnapshot",
      "responderGithubLoginSnapshot",
      "responderDisplayNameSnapshot",
      "contributorPersonId",
      "contributorGithubLoginSnapshot",
      "contributorDisplayNameSnapshot",
      "contributorRolesJsonSnapshot",
      "body",
    ];
    expect(
      sha256Text(
        canonicalJson({
          schema: "oratlas/challenge-response/1",
          ...Object.fromEntries(fields.map((k) => [k, response[k]])),
        }),
      ),
    ).toBe(response.contentHash);
    const actions = native.rows
      .AuditEvent!.filter((r) => r.subjectId === challenge.id || r.subjectId === response.id)
      .map((r) => r.action)
      .sort();
    expect(actions).toEqual([
      "challenge.filed",
      "challenge.response-created",
      "challenge.transitioned",
      "challenge.transitioned",
    ]);
  }
});
function audit(index: number) {
  const t = targets[index]!;
  return {
    data: {
      actorId: t.actorId,
      action: "challenge.response-removed",
      subjectType: "challengeResponse",
      subjectId: t.id,
      detailsJson: canonicalJson({
        challengeId: t.challengeId,
        contentHash: t.contentHash,
        contentRevision: 1,
      }),
    },
  };
}
it("supplies only three scoped actor/target/hash-bound missing audit inputs with exactly one delegation", async () => {
  const fixture = new ResponseModerationAuditFixture();
  let calls = 0;
  for (let i = 0; i < 3; i++) {
    const args = audit(i),
      copy = structuredClone(args);
    const result = await fixture.query("AuditEvent", "create", args, async (prepared) => {
      calls++;
      return prepared;
    });
    expect(args).toEqual(copy);
    expect(result).toEqual({
      data: { ...args.data, id: ids[i], createdAt: new Date(AUDIT_DEFAULT_TIME) },
    });
  }
  await expect(
    fixture.query("AuditEvent", "create", audit(0), async () => {
      calls++;
    }),
  ).rejects.toThrow("Response moderation audit input refused");
  expect(calls).toBe(3);
  expect(fixture.trace.map((t) => t.injected)).toEqual([
    ["id", "createdAt"],
    ["id", "createdAt"],
    ["id", "createdAt"],
  ]);
  expect(fixture.trace.every((t) => t.queryCalls === 1)).toBe(true);
});
it("refuses wrong actor, target, hash/revision, explicit metadata, other creates and nested writes before delegation", async () => {
  let calls = 0;
  const query = async () => {
    calls++;
  };
  const args = audit(0);
  for (const data of [
    { ...args.data, actorId: "g1-user-a-only" },
    { ...args.data, subjectId: targets[1]!.id },
    { ...args.data, detailsJson: "{}" },
    { ...args.data, id: "unapproved" },
    { ...args.data, createdAt: new Date() },
    { ...args.data, platformVersion: "foreign" },
  ])
    await expect(
      new ResponseModerationAuditFixture().query("AuditEvent", "create", { data }, query),
    ).rejects.toThrow();
  for (const [model, operation, data] of [
    ["User", "create", args],
    ["AuditEvent", "createMany", args],
    ["AuditEvent", "upsert", args],
    ["User", "update", { data: { audit: { create: args.data } } }],
  ] as const)
    await expect(
      new ResponseModerationAuditFixture().query(model, operation, data, query),
    ).rejects.toThrow();
  expect(calls).toBe(0);
});
