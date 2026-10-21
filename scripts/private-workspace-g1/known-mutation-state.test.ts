import { expect, it } from "vitest";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import { KNOWN_MUTATION_PROGRAM } from "./known-mutation-descriptor.js";
import {
  expectedKnownPublicState,
  knownPublicStateProblems,
  publicTableSnapshotSql,
  knownMutationLabel,
  KNOWN_NOTIFICATION_SQL_READ_AT,
  type KnownPublicSqlState,
} from "./known-mutation-state.js";
const fixture = (): KnownPublicSqlState => ({
  ...Object.fromEntries(PUBLIC_SELECT_TABLES.map((table) => [table, []])),
  Notification: [
    { id: "one", readAt: null, payloadJson: "retained" },
    { id: "two", readAt: null, payloadJson: "other" },
  ],
});
it("retains the complete current public closure and uses PostgreSQL byte-collated full-row ordering", () => {
  const before = fixture();
  const after = expectedKnownPublicState(before, "one");
  expect(Object.keys(after).sort()).toEqual(PUBLIC_SELECT_TABLES);
  expect(after.Notification).toEqual([
    { id: "one", readAt: KNOWN_NOTIFICATION_SQL_READ_AT, payloadJson: "retained" },
    { id: "two", readAt: null, payloadJson: "other" },
  ]);
  expect(before.Notification![0]!.readAt).toBe(null);
  expect(knownPublicStateProblems(before, after, "one")).toEqual([]);
  for (const table of PUBLIC_SELECT_TABLES)
    expect(publicTableSnapshotSql(table)).toContain(
      'json_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C")',
    );
  for (const table of ["private_ws.Secret", "User;DROP TABLE", "MissingTable"])
    expect(() => publicTableSnapshotSql(table)).toThrow();
});
it("rejects extra/missing rows, unrelated fields and denied-request writes across the entire closure", () => {
  const before = fixture();
  expect(knownPublicStateProblems(before, before)).toEqual([]);
  expect(
    knownPublicStateProblems(before, { ...before, User: [{ id: "unexpected", role: "ADMIN" }] }),
  ).toHaveLength(1);
  expect(
    knownPublicStateProblems(before, {
      ...before,
      Notification: [...before.Notification!, { id: "extra", readAt: null }],
    }),
  ).toHaveLength(1);
  expect(
    knownPublicStateProblems(before, { ...before, Notification: before.Notification!.slice(1) }),
  ).toHaveLength(1);
  const expected = expectedKnownPublicState(before, "one");
  const leaked = {
    ...expected,
    Notification: expected.Notification!.map((row) =>
      row.id === "one" ? { ...row, payloadJson: "changed" } : row,
    ),
  };
  expect(knownPublicStateProblems(before, leaked, "one")).toHaveLength(1);
  expect(knownPublicStateProblems(before, expected)).toHaveLength(1);
  const { AuditEvent: _omitted, ...incomplete } = before;
  expect(() => expectedKnownPublicState(incomplete)).toThrow(
    "Incomplete public snapshot inventory",
  );
  expect(() => expectedKnownPublicState(before, "missing")).toThrow();
  expect(() => expectedKnownPublicState(expected, "one")).toThrow();
});
it("exports a fixed dedicated descriptor and validates the runner label before capture", () => {
  expect(KNOWN_MUTATION_PROGRAM.scenarios).toHaveLength(62);
  expect(KNOWN_MUTATION_PROGRAM.outVariable).toBe("G1_KNOWN_MUTATION_OUT");
  expect(KNOWN_MUTATION_PROGRAM.spec).toBe(
    "scripts/private-workspace-g1/known-mutation-probe.g1.spec.ts",
  );
  expect(Object.keys(KNOWN_MUTATION_PROGRAM.sqlCountDeltas).sort()).toEqual(PUBLIC_SELECT_TABLES);
  expect(Object.values(KNOWN_MUTATION_PROGRAM.sqlCountDeltas).every((delta) => delta === 0)).toBe(
    true,
  );
  expect(knownMutationLabel("baseline-repeat")).toBe("baseline-repeat");
  for (const label of [undefined, "", "Invalid Label", "a".repeat(41), "baseline\n"])
    expect(() => knownMutationLabel(label)).toThrow();
});
