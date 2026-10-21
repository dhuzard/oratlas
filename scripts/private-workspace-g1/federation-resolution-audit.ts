import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { PLATFORM_VERSION } from "../../packages/config/src/index.js";
import { AuditDefaultFixture } from "./audit-default-fixture.js";
import { FEDERATION_RESOLUTION_TARGETS } from "./federation-resolution-scenarios.js";
/** Two declared actor/action/target-bound missing AuditEvent metadata inputs only. */
export class FederationResolutionAuditFixture {
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
    if (operation === "create") {
      const target = FEDERATION_RESOLUTION_TARGETS[this.#next];
      if (
        model !== "AuditEvent" ||
        !target ||
        !args ||
        typeof args !== "object" ||
        !("data" in args) ||
        !args.data ||
        typeof args.data !== "object"
      )
        throw Error("Federation audit input refused");
      const data = { ...args.data };
      if ("platformVersion" in data) {
        if (data.platformVersion !== PLATFORM_VERSION)
          throw Error("Federation audit platform refused");
        delete data.platformVersion;
      }
      const expected = {
        actorId: target.actorId,
        action: "federation.notification-resolved",
        subjectType: "federation-notification",
        subjectId: target.id,
        idempotencyKey: `federation.resolve:${target.id}`,
        detailsJson: canonicalJson({ decision: target.decision, note: target.note }),
      };
      if (canonicalJson(data) !== canonicalJson(expected))
        throw Error("Federation audit input refused");
      this.#next++;
    }
    return this.#fixture.query(model, operation, args, query);
  }
}
