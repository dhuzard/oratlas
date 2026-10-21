import { isDeepStrictEqual } from "node:util";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { PLATFORM_VERSION } from "../../packages/config/src/index.js";
import { AuditDefaultFixture } from "./audit-default-fixture.js";
import { G1_FIXED_CLOCK } from "./capture.js";
import {
  CHALLENGE_MODERATION_TARGETS,
  CHALLENGE_MODERATION_AUDIT_IDS,
} from "./challenge-moderation-scenarios.js";

/** Unwired test inputs: exactly three target-bound updates and their audit appends. */
export class ChallengeModerationInputFixture {
  readonly #fixture = new AuditDefaultFixture();
  #nextUpdate = 0;
  #nextAudit = 0;
  readonly #updates: Array<{ target: string; injected: readonly ["updatedAt"] }> = [];
  get trace() {
    return this.#fixture.trace;
  }
  get updateTrace() {
    return structuredClone(this.#updates);
  }
  async query(
    model: string,
    operation: string,
    args: unknown,
    query: (args: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    let supplied = args;
    if (
      model === "Challenge" &&
      ![
        "findUnique",
        "findUniqueOrThrow",
        "findFirst",
        "findFirstOrThrow",
        "findMany",
        "count",
        "aggregate",
        "groupBy",
      ].includes(operation)
    ) {
      const target = CHALLENGE_MODERATION_TARGETS[this.#nextUpdate];
      if (operation !== "updateMany" || !target || this.#nextUpdate !== this.#nextAudit)
        throw Error("Challenge moderation update input refused");
      const expected = {
        where: { id: target.id, contentStatus: "visible", contentRevision: 0 },
        data: {
          contentStatus: "removed",
          contentRevision: 1,
          removedAt: new Date(G1_FIXED_CLOCK),
          removedById: target.actorId,
          removedByRoleSnapshot: target.role,
        },
      };
      if (!isDeepStrictEqual(args, expected))
        throw Error("Challenge moderation update input refused");
      // Explicit updatedAt, unknown fields and other targets fail the exact input comparison.
      supplied = { ...expected, data: { ...expected.data, updatedAt: new Date(G1_FIXED_CLOCK) } };
      this.#nextUpdate++;
      this.#updates.push({ target: target.id, injected: ["updatedAt"] });
    }
    let slot: number | undefined;
    if (operation === "create") {
      const target = CHALLENGE_MODERATION_TARGETS[this.#nextAudit];
      if (
        model !== "AuditEvent" ||
        !target ||
        this.#nextUpdate !== this.#nextAudit + 1 ||
        !args ||
        typeof args !== "object" ||
        !("data" in args) ||
        !args.data ||
        typeof args.data !== "object"
      )
        throw Error("Challenge moderation audit input refused");
      const data = { ...args.data };
      if ("platformVersion" in data) {
        if (data.platformVersion !== PLATFORM_VERSION)
          throw Error("Challenge moderation audit platform refused");
        delete data.platformVersion;
      }
      const expected = {
        actorId: target.actorId,
        action: "challenge.content-removed",
        subjectType: "challenge",
        subjectId: target.id,
        detailsJson: canonicalJson({ contentHash: target.contentHash, contentRevision: 1 }),
      };
      if (!isDeepStrictEqual(data, expected))
        throw Error("Challenge moderation audit input refused");
      slot = this.#nextAudit++;
    }
    return this.#fixture.query(model, operation, supplied, (prepared) => {
      if (slot === undefined) return query(prepared);
      const value = prepared as { data: Record<string, unknown> };
      return query({ ...value, data: { ...value.data, id: CHALLENGE_MODERATION_AUDIT_IDS[slot] } });
    });
  }
}
