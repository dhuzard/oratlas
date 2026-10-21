import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { replicationPublicUrlSchema } from "../../packages/contracts/src/replication.js";
import {
  assertChallengeLedger,
  assertChallengeResponseIntegrity,
} from "../../apps/web/src/lib/challenge-ledger";

vi.mock("../../apps/web/node_modules/server-only/index.js", () => ({}));
vi.mock("../../apps/web/src/lib/db", () => ({ prisma: {} }));

// This fixture uses only literal quoted values or NULL. Decode the committed
// SQL bytes, not a separately maintained copy of its expected row data.
const sql = readFileSync(
  resolve("scripts/private-workspace-g1/fixtures/scholarly-fixtures.sql"),
  "utf8",
);
function rows(table: string): Record<string, string | null>[] {
  const result: Record<string, string | null>[] = [];
  for (const match of sql.matchAll(/INSERT INTO "([^"]+)" \(([^)]+)\) VALUES\n([\s\S]*?);/gu)) {
    if (match[1] !== table) continue;
    const columns = [...match[2]!.matchAll(/"([^"]+)"/gu)].map((field) => field[1]!);
    const values = [...match[3]!.matchAll(/'((?:[^']|'')*)'|\bNULL\b/gu)].map((value) =>
      value[1] === undefined ? null : value[1].replaceAll("''", "'"),
    );
    expect(values.length % columns.length).toBe(0);
    for (let offset = 0; offset < values.length; offset += columns.length)
      result.push(
        Object.fromEntries(columns.map((column, index) => [column, values[offset + index]!])),
      );
  }
  return result;
}

it("keeps every replication citation accepted by the actual public URL schema", () => {
  const briefs = rows("ReplicationBrief");
  expect(briefs).toHaveLength(3);
  for (const brief of briefs)
    expect(replicationPublicUrlSchema.array().parse(JSON.parse(brief.citationUrlsJson!))).toEqual([
      "https://example.org/g1-synthetic-replication/source",
    ]);
});

it("makes both committed terminal challenges pass the actual ledger and response integrity checks", () => {
  const challenges = rows("Challenge");
  expect(challenges).toHaveLength(2);
  for (const raw of challenges) {
    const transitions = rows("ChallengeTransition")
      .filter((event) => event.challengeId === raw.id)
      .map((event) => ({
        ...event,
        revision: Number(event.revision),
        createdAt: event.createdAt,
        administratorOverride: false,
        administratorOverrideById: null,
        administratorOverrideGithubLoginSnapshot: null,
        administratorOverrideAt: null,
        conflictOfInterestStatus: null,
        actor: {
          id: event.actorId!,
          githubLogin: "synthetic-login",
          role: event.actorRoleSnapshot!,
        },
      }));
    expect(transitions).toHaveLength(3);
    const times = transitions.map((event) => Date.parse(event.createdAt!));
    expect(times[0]!).toBeLessThan(times[1]!);
    expect(times[1]!).toBeLessThan(times[2]!);
    const challenge = {
      ...raw,
      nodeEdgeProposalId: null,
      revision: Number(raw.revision),
      activeChallengerSubjectKey: null,
      transitions,
    };
    const response = rows("ChallengeResponse").find((record) => record.challengeId === raw.id)!;
    expect(response).toBeDefined();
    expect(response.createdAt).toBe(transitions[1]!.createdAt);
    const boundResponse = { ...response, nodeContributorUserId: null };
    expect(createHash("sha256").update(raw.subjectRefJson!).digest("hex")).toBe(
      raw.canonicalSubjectHash,
    );
    // SQL fields were decoded above; compile-time types require nullable fields
    // supplied by DB defaults, asserted by the production validators below.
    expect(() =>
      assertChallengeLedger(
        challenge as unknown as Parameters<typeof assertChallengeLedger>[0],
        null,
      ),
    ).not.toThrow();
    expect(() =>
      assertChallengeResponseIntegrity(
        challenge as unknown as Parameters<typeof assertChallengeResponseIntegrity>[0],
        boundResponse as unknown as Parameters<typeof assertChallengeResponseIntegrity>[1],
      ),
    ).not.toThrow();
    const invalid = { ...challenge, transitions: [transitions[0]!, transitions[2]!] };
    expect(() =>
      assertChallengeLedger(
        invalid as unknown as Parameters<typeof assertChallengeLedger>[0],
        null,
      ),
    ).toThrow();
  }
});
