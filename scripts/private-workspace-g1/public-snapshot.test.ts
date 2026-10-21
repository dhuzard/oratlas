import { expect, it } from "vitest";
import { decodePublicSnapshot, publicSnapshotSql, readPublicSnapshot } from "./public-snapshot.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import { knownPublicStateProblems, publicTableSnapshotSql } from "./known-mutation-state.js";
function response() {
  return Object.fromEntries(
    [...PUBLIC_SELECT_TABLES]
      .reverse()
      .map((table) => [
        table,
        [{ id: `fixture-${table}`, nullable: null, nested: { z: [2, 1], a: "unchanged" } }],
      ]),
  );
}
it("preserves exact table/row/field identity and serial insertion order despite database object key order", () => {
  const input = response();
  const result = decodePublicSnapshot([{ snapshot: input }]);
  const serial = Object.fromEntries(PUBLIC_SELECT_TABLES.map((table) => [table, input[table]]));
  expect(JSON.stringify(result)).toBe(JSON.stringify(serial));
  expect(Object.keys(result)).toEqual(PUBLIC_SELECT_TABLES);
  for (const table of PUBLIC_SELECT_TABLES) expect(result[table]).toBe(input[table]);
  expect(Object.keys(input)).toEqual([...PUBLIC_SELECT_TABLES].reverse());
  const changed = structuredClone(result) as Record<string, Array<Record<string, unknown>>>;
  changed.User![0]!.nullable = "same-count changed field";
  expect(changed.User).toHaveLength(result.User!.length);
  expect(knownPublicStateProblems(result, changed)).toEqual([
    "Unexpected public row or field delta",
  ]);
});
it("refuses missing/extra tables, malformed rows and unsafe identifier selectors generically", () => {
  const input = response();
  const missing = { ...input };
  delete missing.User;
  for (const raw of [
    [],
    [{ snapshot: missing }],
    [{ snapshot: { ...input, PrivateWorkspace: [] } }],
    [{ snapshot: { ...input, User: null } }],
    [{ snapshot: { ...input, User: [null] } }],
    [{ snapshot: input, unexpected: "not retained" }],
  ])
    expect(() => decodePublicSnapshot(raw)).toThrow("Invalid complete public snapshot");
  for (const table of [
    'User";SELECT secret;--',
    "private_ws.User",
    "User'",
    "__proto__",
    "UnreviewedTable",
  ])
    expect(() => publicTableSnapshotSql(table)).toThrow("Unreviewed public snapshot table");
  const sql = publicSnapshotSql();
  expect(sql).not.toContain("private_ws");
  expect(sql).not.toContain("json_build_object");
  expect(sql.match(/FROM public\."/gu) ?? []).toHaveLength(PUBLIC_SELECT_TABLES.length);
  for (const table of PUBLIC_SELECT_TABLES)
    expect(sql).toContain(`('${table}', (${publicTableSnapshotSql(table)}))`);
});
it("delegates exactly one compiled statement and preserves native execution failures without retry", async () => {
  const statements: string[] = [];
  const result = [{ snapshot: response() }];
  const reader = {
    async $queryRawUnsafe<T>(sql: string): Promise<T> {
      statements.push(sql);
      return result as T;
    },
  };
  expect(await readPublicSnapshot(reader)).toEqual(decodePublicSnapshot(result));
  expect(statements).toEqual([publicSnapshotSql()]);
  const failure = { native: "failure" };
  let calls = 0;
  await expect(
    readPublicSnapshot({
      $queryRawUnsafe: () => {
        calls++;
        return Promise.reject(failure);
      },
    }),
  ).rejects.toBe(failure);
  expect(calls).toBe(1);
});
