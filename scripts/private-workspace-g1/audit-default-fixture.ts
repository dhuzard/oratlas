/** Unwired synthetic query-argument fixture. Never imported by production code. */
export const AUDIT_DEFAULT_PROTOCOL = "oratlas.g1.audit-default-input/0.1";
export const AUDIT_DEFAULT_TIME = "2026-04-01T00:00:00.000Z";
export const AUDIT_DEFAULT_IDS = [
  "g1-audit-default-1",
  "g1-audit-default-2",
  "g1-audit-default-rollback",
] as const;
const creates = new Set(["create", "createMany", "createManyAndReturn", "upsert"]);
const nestedWrites = new Set(["create", "createMany", "connectOrCreate", "upsert"]);
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)
  );
}
function containsNestedWrite(value: unknown, depth = 0): boolean {
  if (depth > 32) throw Error("Audit fixture argument bound refused");
  if (value instanceof Date || value === null || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, entry]) => nestedWrites.has(key) || containsNestedWrite(entry, depth + 1),
  );
}
export class AuditDefaultFixture {
  #next = 0;
  readonly trace: Array<{
    ordinal: number;
    model: string;
    operation: string;
    injected: string[];
    queryCalls: number;
  }> = [];
  prepare(model: string, operation: string, args: unknown): unknown {
    if (!record(args)) throw Error("Unsupported audit fixture arguments");
    if (creates.has(operation) && (model !== "AuditEvent" || operation !== "create"))
      throw Error("Unsupported audit fixture create");
    if (containsNestedWrite(args)) throw Error("Nested audit fixture write refused");
    if (operation !== "create") return args;
    if (!record(args.data)) throw Error("Unsupported audit fixture data");
    const data = args.data;
    if (
      (Object.hasOwn(data, "id") && (typeof data.id !== "string" || !data.id)) ||
      (Object.hasOwn(data, "createdAt") &&
        !(data.createdAt instanceof Date) &&
        typeof data.createdAt !== "string")
    )
      throw Error("Unsupported explicit audit fixture metadata");
    const missing = ["id", "createdAt"].filter((key) => !Object.hasOwn(data, key));
    if (!missing.length) return args;
    const id = AUDIT_DEFAULT_IDS[this.#next++];
    if (!id) throw Error("Audit fixture default sequence exhausted");
    return {
      ...args,
      data: {
        ...data,
        ...(missing.includes("id") ? { id } : {}),
        ...(missing.includes("createdAt") ? { createdAt: new Date(AUDIT_DEFAULT_TIME) } : {}),
      },
    };
  }
  async query(
    model: string,
    operation: string,
    args: unknown,
    query: (args: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    const prepared = this.prepare(model, operation, args);
    const data = record(args) && record(args.data) ? args.data : undefined;
    const entry = {
      ordinal: this.trace.length,
      model,
      operation,
      injected:
        operation === "create"
          ? ["id", "createdAt"].filter((key) => data && !Object.hasOwn(data, key))
          : [],
      queryCalls: 0,
    };
    this.trace.push(entry);
    entry.queryCalls++;
    return query(prepared);
  }
}
