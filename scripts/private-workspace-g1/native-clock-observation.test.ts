import { expect, it } from "vitest";
import { nativeClockUpdateProblems } from "./native-clock-observation.js";
const instant = (ms: number) => new Date(ms).toISOString();
const input = {
  beforeUpdatedAt: instant(1000),
  afterUpdatedAt: instant(10005),
  beforeEpochMs: 10000,
  afterEpochMs: 10010,
  skewBudgetMs: 100,
};
it("accepts an advancing timestamp only inside an explicit bounded real-clock window", () => {
  expect(nativeClockUpdateProblems(input)).toEqual([]);
  expect(nativeClockUpdateProblems({ ...input, afterUpdatedAt: instant(9900) })).toEqual([]);
  expect(nativeClockUpdateProblems({ ...input, afterUpdatedAt: instant(10110) })).toEqual([]);
});
it("rejects unchanged, stale, and future values without replacing their raw bytes", () => {
  expect(nativeClockUpdateProblems({ ...input, afterUpdatedAt: input.beforeUpdatedAt })).toContain(
    "Native timestamp did not advance from fixture",
  );
  expect(nativeClockUpdateProblems({ ...input, afterUpdatedAt: instant(9899) })).toContain(
    "Native timestamp outside observed real-clock window",
  );
  expect(nativeClockUpdateProblems({ ...input, afterUpdatedAt: instant(10111) })).toContain(
    "Native timestamp outside observed real-clock window",
  );
  expect(nativeClockUpdateProblems({ ...input, afterUpdatedAt: "invalid" })).toEqual([
    "Invalid native timestamp",
  ]);
});
it("refuses unbounded, negative and inverted observational assumptions", () => {
  for (const skewBudgetMs of [Infinity, NaN, -1, 1001])
    expect(nativeClockUpdateProblems({ ...input, skewBudgetMs })).toHaveLength(1);
  expect(nativeClockUpdateProblems({ ...input, beforeEpochMs: 10020 })).toHaveLength(1);
});
