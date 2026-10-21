import { PUBLIC_SELECT_TABLES } from "./sql.js";
import { publicTableSnapshotSql, type KnownPublicSqlState } from "./known-mutation-state.js";

// This scope is compiled, never a caller/environment/database-provided table selector.
const TABLES = Object.freeze([...PUBLIC_SELECT_TABLES]);
if (new Set(TABLES).size !== TABLES.length) throw Error("Invalid public snapshot scope");
const SQL = `SELECT json_object_agg(table_name, table_rows) AS snapshot FROM (VALUES
${TABLES.map((table) => `('${table}', (${publicTableSnapshotSql(table)}))`).join(",\n")}
) AS snapshots(table_name, table_rows)`;
export function publicSnapshotSql(): string {
  return SQL;
}
function record(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
/** Restore the old serial adapter's table insertion order; retain native rows/fields/order verbatim. */
export function decodePublicSnapshot(result: unknown): KnownPublicSqlState {
  const refuse = () => {
    throw Error("Invalid complete public snapshot");
  };
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    !record(result[0]) ||
    Object.keys(result[0]).length !== 1 ||
    !Object.hasOwn(result[0], "snapshot") ||
    !record(result[0].snapshot)
  )
    return refuse();
  const snapshot = result[0].snapshot;
  if (
    Object.keys(snapshot).length !== TABLES.length ||
    TABLES.some((table) => !Object.hasOwn(snapshot, table))
  )
    return refuse();
  for (const table of TABLES) {
    const rows = snapshot[table];
    if (!Array.isArray(rows) || rows.some((row) => !record(row))) return refuse();
  }
  return Object.fromEntries(TABLES.map((table) => [table, snapshot[table]])) as KnownPublicSqlState;
}
export type PublicSnapshotReader = { $queryRawUnsafe<T = unknown>(sql: string): PromiseLike<T> };
/** One real PostgreSQL statement, with the same native per-table expression and exact public grants. */
export async function readPublicSnapshot(
  reader: PublicSnapshotReader,
): Promise<KnownPublicSqlState> {
  return decodePublicSnapshot(await reader.$queryRawUnsafe(publicSnapshotSql()));
}
