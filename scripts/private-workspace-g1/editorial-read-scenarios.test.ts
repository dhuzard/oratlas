import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { PRINCIPAL_LABELS } from "./principals.js";
import { programProblems } from "./scenarios.js";
import { EDITORIAL_READ_SCENARIOS } from "./editorial-read-scenarios.js";
import {
  EDITORIAL_READ_ROUTE_MODULES,
  EDITORIAL_READ_SELECT_TABLES,
} from "./editorial-read-routes.js";
import {
  formalReviewReportBodySchema,
  authorResponseBodySchema,
} from "../../packages/contracts/src/editorial.js";
import { announceReviewSchema } from "../../packages/federation/src/notify.js";
import { sha256Text } from "./principals.js";

it("covers four real read surfaces and OPTIONS with all six principal recipes", () => {
  expect(programProblems(EDITORIAL_READ_SCENARIOS)).toEqual([]);
  expect(new Set(EDITORIAL_READ_SCENARIOS.map((s) => s.route))).toEqual(
    new Set(Object.keys(EDITORIAL_READ_ROUTE_MODULES)),
  );
  for (const route of Object.keys(EDITORIAL_READ_ROUTE_MODULES)) {
    expect(
      new Set(EDITORIAL_READ_SCENARIOS.filter((s) => s.route === route).map((s) => s.principal)),
    ).toEqual(new Set(PRINCIPAL_LABELS));
    expect(readFileSync(`apps/web/src/app/${route}/route.ts`, "utf8")).toContain("function GET");
  }
  expect(EDITORIAL_READ_SCENARIOS.every((s) => s.method === "GET" || s.method === "OPTIONS")).toBe(
    true,
  );
  expect(EDITORIAL_READ_SELECT_TABLES).toContain("FederationNotification");
});

it("requires real nonempty projections, editor/admin success, and public hidden/tombstone controls", () => {
  const queue = EDITORIAL_READ_SCENARIOS.filter((s) => s.id.includes("federation-queue"));
  expect(queue.map((s) => s.expect.status)).toEqual([401, 403, 403, 403, 200, 200]);
  const reads = EDITORIAL_READ_SCENARIOS.filter((s) =>
    s.id.includes("proposals-g1-fixture-review"),
  );
  expect(reads).toHaveLength(6);
  for (const read of reads) {
    expect(read.expect.json).toContainEqual({ pointer: "/proposals", length: 2 });
    expect(read.expect.bodyExcludes).toContain("g1-read-tombstone-proposal");
  }
  expect(EDITORIAL_READ_SCENARIOS.filter((s) => s.method === "OPTIONS")).toHaveLength(12);
});

it("seeds contract-valid immutable report/response bodies and exact SHA256 values", () => {
  const sql = readFileSync(
    "scripts/private-workspace-g1/fixtures/editorial-read-fixtures.sql",
    "utf8",
  );
  const bodies = [...sql.matchAll(/'(\{"[^\n]+?\})','([0-9a-f]{64})'/gu)];
  const report = bodies.find((match) => match[1]!.includes('"strengths"'));
  const response = bodies.find((match) => match[1]!.includes('"response"'));
  expect(report).toBeDefined();
  expect(response).toBeDefined();
  formalReviewReportBodySchema.parse(JSON.parse(report![1]!));
  authorResponseBodySchema.parse(JSON.parse(response![1]!));
  for (const match of bodies) {
    expect(sha256Text(match[1]!)).toBe(match[2]);
    if (match[1]!.includes('"@context"')) announceReviewSchema.parse(JSON.parse(match[1]!));
  }
  expect(bodies.filter((match) => match[1]!.includes('"@context"'))).toHaveLength(5);
});

it("seeds reachable open-round prerequisites and the report writer's actual manual ORCID snapshot", () => {
  const sql = readFileSync(
    "scripts/private-workspace-g1/fixtures/editorial-read-fixtures.sql",
    "utf8",
  );
  const row = (table: string): Record<string, string> => {
    const insert = sql.split(`INSERT INTO "${table}" (`)[1]?.split(";")[0];
    if (!insert) throw new Error(`Missing fixture ${table}`);
    const [columns, values] = insert.split(")\nVALUES (");
    const keys = [...columns!.matchAll(/"([^"]+)"/gu)].map((match) => match[1]!);
    const cells = [...values!.matchAll(/'(?:''|[^'])*'|NULL|true|false|\d+/gu)].map((match) =>
      match[0].startsWith("'") ? match[0].slice(1, -1).replaceAll("''", "'") : match[0],
    );
    expect(cells).toHaveLength(keys.length);
    return Object.fromEntries(keys.map((key, index) => [key, cells[index]!]));
  };
  const submission = row("Submission");
  const assignment = row("EditorAssignment");
  const round = row("ReviewRound");
  const report = row("FormalReviewReport");
  const response = row("AuthorResponse");
  expect(submission.status).toBe("pending-editorial-review");
  expect(assignment.submissionId).toBe(submission.id);
  expect(assignment.editorId).toBe(round.openedById);
  expect(assignment.status).toBe("active");
  expect(assignment.coiDeclared).toBe("true");
  expect(assignment.assignedById).toBe("g1-user-admin");
  expect(round.submissionId).toBe(submission.id);
  expect(round.status).toBe("open");
  expect(round.roundNumber).toBe("1");
  expect(assignment.createdAt! < round.openedAt!).toBe(true);
  expect(report.roundId).toBe(round.id);
  expect(report.reviewerId).not.toBe(submission.submitterId);
  expect(report.reviewerId).not.toBe(assignment.editorId);
  expect(report.reviewerId).toBe("g1-user-b-only");
  expect(report.reviewerOrcid).toBe("0000-0000-0000-0002");
  expect(report.reviewerOrcidVerified).toBe("false");
  expect(response.authorId).toBe(submission.submitterId);
  expect(round.openedAt! < report.submittedAt! && report.submittedAt! < response.submittedAt!).toBe(
    true,
  );
  const native = readFileSync("scripts/private-workspace-g1/fixtures/public-fixtures.sql", "utf8");
  expect(native).toContain("'G1 Fixture B-only', 'USER', '0000-0000-0000-0002', NULL");
});
