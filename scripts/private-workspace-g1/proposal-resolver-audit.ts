import { PLATFORM_VERSION } from "../../packages/config/src/index.js";
import targets from "./fixtures/proposal-resolver-targets.json";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
export const RESOLVER_AUDIT_INPUTS = targets.map((target) => ({
  platformVersion: PLATFORM_VERSION,
  actorId: target.actor === "EDITOR" ? "g1-user-editor" : "g1-user-admin",
  action:
    target.kind === "protocol" ? "protocol.proposal-resolved" : "monitoring.proposal-resolved",
  subjectType: target.kind === "protocol" ? "protocol-drift-proposal" : "claim-update-proposal",
  subjectId: target.id,
  detailsJson: canonicalJson({
    resolution: target.kind === "protocol" ? "explained" : "resolved-no-action",
  }),
}));
/** Isolated resolver input fixture: native defaults outside these four absent metadata inputs are untested. */
export const RESOLVER_AUDIT_IDS = [
  "g1-resolve-protocol-editor",
  "g1-resolve-protocol-admin",
  "g1-resolve-monitoring-editor",
  "g1-resolve-monitoring-admin",
] as const;
export const RESOLVER_AUDIT_TIME = "2026-04-01T00:00:00.000Z";
type Dict = Record<string, unknown>;
const record = (v: unknown): v is Dict =>
  v !== null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);
function nested(v: unknown, depth = 0): boolean {
  if (depth > 32) throw Error("Resolver input argument bound refused");
  if (!record(v) && !Array.isArray(v)) return false;
  return Object.entries(v).some(
    ([k, x]) =>
      ["create", "createMany", "connectOrCreate", "upsert"].includes(k) || nested(x, depth + 1),
  );
}
export class ResolverAuditFixture {
  #next = 0;
  readonly trace: {
    ordinal: number;
    model: string;
    operation: string;
    injected: string[];
    queryCalls: number;
  }[] = [];
  async query(
    model: string,
    operation: string,
    args: unknown,
    query: (a: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    if (!record(args) || nested(args)) throw Error("Unsupported resolver query shape");
    let prepared = args;
    const injected: string[] = [];
    if (["create", "createMany", "createManyAndReturn", "upsert"].includes(operation)) {
      if (model !== "AuditEvent" || operation !== "create" || !record(args.data))
        throw Error("Unsupported resolver create");
      const d = args.data;
      const expected = RESOLVER_AUDIT_INPUTS[this.#next];
      if (!expected) throw Error("Resolver audit sequence exhausted");
      if (
        Object.entries(expected).some(([key, value]) => d[key] !== value) ||
        Object.keys(d).some(
          (key) => !Object.hasOwn(expected, key) && !["id", "createdAt"].includes(key),
        )
      )
        throw Error("Unexpected resolver audit actor/action/target");
      const id = RESOLVER_AUDIT_IDS[this.#next++];
      // Explicit fields are preserved. The contract only supplies genuinely absent defaults.
      if (
        (Object.hasOwn(d, "id") && (typeof d.id !== "string" || !d.id)) ||
        (Object.hasOwn(d, "createdAt") &&
          !(d.createdAt instanceof Date) &&
          typeof d.createdAt !== "string")
      )
        throw Error("Unsupported explicit resolver metadata");
      injected.push(...["id", "createdAt"].filter((k) => !Object.hasOwn(d, k)));
      if (injected.length) {
        prepared = {
          ...args,
          data: {
            ...d,
            ...(!Object.hasOwn(d, "id") ? { id } : {}),
            ...(!Object.hasOwn(d, "createdAt") ? { createdAt: new Date(RESOLVER_AUDIT_TIME) } : {}),
          },
        };
      }
    }
    const row = { ordinal: this.trace.length, model, operation, injected, queryCalls: 1 };
    this.trace.push(row);
    return query(prepared);
  }
}
