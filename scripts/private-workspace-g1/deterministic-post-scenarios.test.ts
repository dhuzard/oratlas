import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { discussionTraversalScopeSchema } from "../../packages/contracts/src/discussion.js";
import {
  announceReviewSchema,
  parseCoarNotifyActivity,
} from "../../packages/federation/src/notify.js";
import { programProblems } from "./scenarios.js";
import { G1_SESSION_SECRET, PRINCIPAL_LABELS, sha256Text } from "./principals.js";
import {
  POST_INPUTS,
  DETERMINISTIC_POST_SCENARIOS,
  DETERMINISTIC_POST_PROGRAM,
} from "./deterministic-post-scenarios.js";
const sql = readFileSync(
  new URL("./fixtures/deterministic-post-fixtures.sql", import.meta.url),
  "utf8",
);
const inserted = [
  ...sql.matchAll(
    /INSERT INTO "([A-Za-z]+)" SELECT \(jsonb_populate_record\(NULL::"[A-Za-z]+", '((?:''|[^'])*)'::jsonb\)\)\.\*;/gu,
  ),
].map((match) => ({
  table: match[1]!,
  row: JSON.parse(match[2]!.replaceAll("''", "'")) as Record<string, unknown>,
}));
it("declares all six cookie principals, three nonempty native positive paths and bounded denials", () => {
  expect(programProblems(DETERMINISTIC_POST_SCENARIOS)).toEqual([]);
  expect(DETERMINISTIC_POST_SCENARIOS).toHaveLength(96);
  const statuses = DETERMINISTIC_POST_SCENARIOS.reduce<Record<string, number>>(
    (counts, s) => ((counts[s.expect.status] = (counts[s.expect.status] ?? 0) + 1), counts),
    {},
  );
  expect(statuses).toEqual({ 200: 14, 400: 24, 401: 4, 403: 12, 404: 6, 409: 36 });
  for (const principal of PRINCIPAL_LABELS) {
    const own = DETERMINISTIC_POST_SCENARIOS.filter((s) => s.principal === principal);
    expect(own).toHaveLength(16);
    expect(own.filter((s) => s.expect.status === 200)).toHaveLength(
      principal === "EDITOR" || principal === "ADMIN" ? 3 : 2,
    );
    expect(new Set(own.map((s) => s.route)).size).toBe(3);
    for (const scenario of own) {
      expect(scenario.method).toBe("POST");
      expect(scenario.workerAuthority).toBeUndefined();
      expect(scenario.headers).not.toHaveProperty("authorization");
      expect(scenario.body).not.toHaveProperty("llm");
    }
  }
  expect(DETERMINISTIC_POST_PROGRAM.outVariable).toBe("G1_DETERMINISTIC_POST_OUT");
});
it("pins actual native public HMAC scopes and distinguishes valid signed controls from token tampering", () => {
  for (const scope of Object.values(POST_INPUTS.scopes)) {
    const parsed = discussionTraversalScopeSchema.parse(scope);
    const { signature, ...unsigned } = parsed;
    expect(signature).toBe(
      createHmac("sha256", G1_SESSION_SECRET)
        .update(`oratlas-discussion-traversal-v1\n${canonicalJson(unsigned)}`)
        .digest("base64url"),
    );
  }
  const altered = DETERMINISTIC_POST_SCENARIOS.find(
    (s) => s.id === "deterministic-post-discuss-tampered-anonymous",
  )!.body as { scope: { signature: string } };
  expect(altered.scope.signature).not.toBe(POST_INPUTS.scopes.visible.signature);
  for (const kind of ["hidden", "tombstone", "missing", "stale", "detached"])
    expect(
      DETERMINISTIC_POST_SCENARIOS.find(
        (s) => s.id === `deterministic-post-discuss-${kind}-anonymous`,
      )!.expect.status,
    ).toBe(409);
});
it("binds complete native RequestReview/AnnounceReview payloads and preserves source-declared federation semantics", () => {
  expect(parseCoarNotifyActivity(POST_INPUTS.inbox.payload).pattern).toBe("request-review");
  expect(sha256Text(canonicalJson(POST_INPUTS.inbox.payload))).toBe(POST_INPUTS.inbox.hash);
  const announcement = announceReviewSchema.parse(POST_INPUTS.announcement.payload);
  expect(sha256Text(canonicalJson(announcement))).toBe(POST_INPUTS.announcement.hash);
  expect(announcement.inReplyTo).toBe("https://example.org/g1-notify/accepted-old");
  expect(announcement.object.id).toContain("/versions/g1-version-2");
  expect(announcement.id).toBe("urn:uuid:ceb8b432-4dd7-50b1-aca4-fc41ca46730c");
  const collision = DETERMINISTIC_POST_SCENARIOS.find(
    (s) => s.id === "deterministic-post-inbox-collision-anonymous",
  )!.body;
  expect(parseCoarNotifyActivity(collision).activityId).toBe(POST_INPUTS.inbox.payload.id);
  expect(sha256Text(canonicalJson(collision))).not.toBe(POST_INPUTS.inbox.hash);
});
it("retains native canonical source bindings, exact scoped edge endpoints and all declared setup deltas", () => {
  const counts = inserted.reduce<Record<string, number>>(
    (counts, { table }) => ((counts[table] = (counts[table] ?? 0) + 1), counts),
    {},
  );
  expect(counts).toEqual(POST_INPUTS.addedRows);
  expect(inserted).toHaveLength(26);
  const versions = inserted
    .filter((item) => item.table === "KnowledgeNodeVersion")
    .map((item) => item.row);
  const claim = versions.find((row) => row.sourceClaimId === "g1-claim-1")!;
  const citation = versions.find((row) => row.sourceCitationId === "g1-citation-1")!;
  expect(claim.text).toBe("Synthetic fixture claim: paired public captures are byte-identical.");
  expect(JSON.parse(claim.provenanceJson as string)).toEqual({
    claimId: "g1-claim-1",
    reviewVersionId: "g1-version-2",
    sourceType: "claim-occurrence",
  });
  expect(new Set(POST_INPUTS.scopes.visible.nodes.map((n) => n.nodeVersionId))).toEqual(
    new Set([claim.id, citation.id]),
  );
  const edge = inserted.find(
    (item) => item.table === "NodeEdge" && item.row.id === POST_INPUTS.scopes.visible.edgeIds[0],
  )!.row;
  expect(edge).toMatchObject({
    sourceNodeVersionId: claim.id,
    targetNodeId: citation.knowledgeNodeId,
    confirmedTargetNodeVersionId: citation.id,
    relationType: "supports",
    status: "source-assertion",
    provenance: "imported-from-review",
    confirmedById: null,
  });
  expect(
    versions.find((row) => row.id === POST_INPUTS.scopes.hidden.nodes[0]!.nodeVersionId)!
      .sourceClaimId,
  ).toBe("g1-claim-control");
  expect(
    versions.find((row) => row.id === POST_INPUTS.scopes.tombstone.nodes[0]!.nodeVersionId)!
      .sourceClaimId,
  ).toBe("g1-read-tombstone-claim");
  const updates = [...sql.matchAll(/UPDATE "([A-Za-z]+)" SET (.*?) WHERE id='([^']+)';/gu)].map(
    (match) => ({
      table: match[1]!,
      id: match[3]!,
      fields: [...match[2]!.matchAll(/"([A-Za-z]+)"=/gu)].map((m) => m[1]!).sort(),
    }),
  );
  expect(updates).toEqual(
    Object.entries(POST_INPUTS.fixtureUpdates).flatMap(([table, rows]) =>
      rows.map((row) => ({ table, ...row })),
    ),
  );
  expect(sql).not.toMatch(/\b(?:GRANT|ALTER|TRUNCATE|DELETE|DROP|now\(\))\b/iu);
  expect(sql).not.toContain("private_ws");
});
