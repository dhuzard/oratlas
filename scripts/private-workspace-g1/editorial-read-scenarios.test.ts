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
