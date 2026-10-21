import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { programProblems } from "./scenarios.js";
import {
  FRESH_REMOVAL_STEPS,
  FRESH_REMOVAL_SCENARIOS,
  FRESH_REMOVAL_TARGETS,
} from "./fresh-removal-scenarios.js";
it("declares three attributable native transitions, exact repeats and nonempty redacted public reads", () => {
  expect(programProblems(FRESH_REMOVAL_SCENARIOS)).toEqual([]);
  expect(FRESH_REMOVAL_STEPS.filter((step) => step.removal).map((step) => step.removal)).toEqual(
    FRESH_REMOVAL_TARGETS,
  );
  expect(FRESH_REMOVAL_SCENARIOS).toHaveLength(24);
  expect(FRESH_REMOVAL_SCENARIOS.filter((step) => step.repeatOf)).toHaveLength(6);
  expect(FRESH_REMOVAL_SCENARIOS.filter((step) => step.method === "GET")).toHaveLength(6);
});
it("adds only a fixed visible control without changing existing rows or shared fixtures", () => {
  const sql = readFileSync(
    "scripts/private-workspace-g1/fixtures/fresh-removal-fixtures.sql",
    "utf8",
  );
  expect(sql.match(/INSERT INTO/gu)).toHaveLength(1);
  expect(sql).not.toMatch(/^\s*(UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT)\b/gmu);
  expect(sql).toContain("'g1-fresh-remaining','g1-review-1','g1-version-2','g1-user-b-only'");
});
