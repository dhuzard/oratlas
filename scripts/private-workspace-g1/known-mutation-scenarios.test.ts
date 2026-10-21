import { expect, it } from "vitest";
import { programProblems } from "./scenarios.js";
import {
  KNOWN_MUTATION_SCENARIOS,
  KNOWN_MUTATION_STEPS,
  KNOWN_NOTIFICATION_TARGETS,
} from "./known-mutation-scenarios.js";
import { PRINCIPAL_LABELS } from "./principals.js";
it("declares all six principals on both mutation methods with real ownership denials", () => {
  expect(programProblems(KNOWN_MUTATION_SCENARIOS)).toEqual([]);
  for (const [route, method] of [
    ["api/comments/[id]", "DELETE"],
    ["api/notifications", "POST"],
  ])
    expect(
      new Set(
        KNOWN_MUTATION_SCENARIOS.filter((s) => s.route === route && s.method === method).map(
          (s) => s.principal,
        ),
      ),
    ).toEqual(new Set(PRINCIPAL_LABELS));
  const own = KNOWN_MUTATION_SCENARIOS.filter((s) => s.id.includes("notification-own"));
  expect(own.map((s) => s.expect.status)).toEqual([401, 200, 200, 200, 200, 200]);
  expect(
    KNOWN_MUTATION_SCENARIOS.filter((s) => s.id.includes("notification-repeat")).map(
      (s) => s.expect.status,
    ),
  ).toEqual([401, 404, 404, 404, 404, 404]);
});
it("keeps every cross-owner request before writes and records exactly five existing target changes", () => {
  const firstWrite = KNOWN_MUTATION_STEPS.findIndex((s) => s.newlyRead.length > 0);
  expect(
    KNOWN_MUTATION_STEPS.filter((s) => s.scenario.id.includes("notification-cross")).every(
      (s) => KNOWN_MUTATION_STEPS.indexOf(s) < firstWrite,
    ),
  ).toBe(true);
  expect(new Set(KNOWN_MUTATION_STEPS.at(-1)!.newlyRead)).toEqual(
    new Set(Object.values(KNOWN_NOTIFICATION_TARGETS)),
  );
  expect(KNOWN_MUTATION_STEPS.every((s) => s.newRemoval === undefined)).toBe(true);
});
