import { PUBLIC_SELECT_TABLES } from "./sql.js";

export type KnownPublicSqlState = Readonly<
  Record<string, readonly Readonly<Record<string, unknown>>[]>
>;
/** Exact PostgreSQL to_jsonb timestamp representation of the reviewed fixed JS instant. */
export const KNOWN_NOTIFICATION_SQL_READ_AT = "2026-04-01T00:00:00";
export function publicTableSnapshotSql(table: string): string {
  if (!/^[A-Z][A-Za-z0-9]{0,62}$/u.test(table) || !PUBLIC_SELECT_TABLES.includes(table))
    throw new Error("Unreviewed public snapshot table");
  return `SELECT COALESCE(json_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"), '[]'::json) AS rows FROM public."${table}" t`;
}
/** Every column of every table is retained. Only one known unread notification field may change. */
export function expectedKnownPublicState(
  before: KnownPublicSqlState,
  readTarget?: string,
): KnownPublicSqlState {
  const tables = Object.keys(before).sort();
  if (JSON.stringify(tables) !== JSON.stringify(PUBLIC_SELECT_TABLES))
    throw new Error("Incomplete public snapshot inventory");
  if (readTarget === undefined) return before;
  const targets = before.Notification!.filter((row) => row.id === readTarget);
  if (targets.length !== 1 || targets[0]!.readAt !== null)
    throw new Error("Expected exactly one unread notification target");
  return {
    ...before,
    Notification: before.Notification!.map((row) =>
      row.id === readTarget ? { ...row, readAt: KNOWN_NOTIFICATION_SQL_READ_AT } : row,
    ),
  };
}
export function knownMutationLabel(value: string | undefined): string {
  if (!value || !/^[a-z0-9-]{1,40}$/u.test(value)) throw new Error("G1_CAPTURE_LABEL is required");
  return value;
}

export function knownPublicStateProblems(
  before: KnownPublicSqlState,
  after: KnownPublicSqlState,
  readTarget?: string,
): string[] {
  const expected = expectedKnownPublicState(before, readTarget);
  // Captured table and row ordering is fixed by PUBLIC_SELECT_TABLES and PostgreSQL byte collation.
  return JSON.stringify(after) === JSON.stringify(expected)
    ? []
    : ["Unexpected public row or field delta"];
}
