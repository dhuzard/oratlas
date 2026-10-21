import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { PLATFORM_VERSION } from "../../packages/config/src/index.js";
import { AuditDefaultFixture } from "./audit-default-fixture.js";
import {
  RESPONSE_MODERATION_TARGETS,
  RESPONSE_MODERATION_AUDIT_IDS,
} from "./response-moderation-scenarios.js";
/** Three exact missing-metadata inputs only; scoped fixture IDs replace the generic slot names. */
export class ResponseModerationAuditFixture {
  readonly #fixture = new AuditDefaultFixture();
  #next = 0;
  get trace() {
    return this.#fixture.trace;
  }
  async query(
    model: string,
    operation: string,
    args: unknown,
    query: (args: unknown) => Promise<unknown>,
  ): Promise<unknown> {
    let slot: number | undefined;
    if (operation === "create") {
      const target = RESPONSE_MODERATION_TARGETS[this.#next];
      if (
        model !== "AuditEvent" ||
        !target ||
        !args ||
        typeof args !== "object" ||
        !("data" in args) ||
        !args.data ||
        typeof args.data !== "object"
      )
        throw Error("Response moderation audit input refused");
      const data = { ...args.data };
      if ("platformVersion" in data) {
        if (data.platformVersion !== PLATFORM_VERSION)
          throw Error("Response moderation audit platform refused");
        delete data.platformVersion;
      }
      const expected = {
        actorId: target.actorId,
        action: "challenge.response-removed",
        subjectType: "challengeResponse",
        subjectId: target.id,
        detailsJson: canonicalJson({
          challengeId: target.challengeId,
          contentHash: target.contentHash,
          contentRevision: 1,
        }),
      };
      if (canonicalJson(data) !== canonicalJson(expected))
        throw Error("Response moderation audit input refused");
      slot = this.#next++;
    }
    return this.#fixture.query(model, operation, args, (prepared) => {
      if (slot === undefined) return query(prepared);
      const value = prepared as { data: Record<string, unknown> };
      return query({ ...value, data: { ...value.data, id: RESPONSE_MODERATION_AUDIT_IDS[slot] } });
    });
  }
}
