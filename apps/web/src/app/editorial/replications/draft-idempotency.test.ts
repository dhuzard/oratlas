import { describe, expect, it, vi } from "vitest";
import { getOrCreateDraftRequestIdentity, settleDraftRequestIdentity } from "./draft-idempotency";

describe("replication draft request identity", () => {
  it("replays the same key after commit-response loss for an identical canonical payload", () => {
    const create = vi.fn().mockReturnValueOnce("request-1").mockReturnValueOnce("request-2");
    const payload = { title: "Draft", scope: { outcome: "Memory", population: "Adults" } };
    const submitted = getOrCreateDraftRequestIdentity(null, payload, create);

    // The server may have committed before the connection disappeared.
    const retained = settleDraftRequestIdentity(submitted, { kind: "transport-error" });
    const replay = getOrCreateDraftRequestIdentity(
      retained,
      { scope: { population: "Adults", outcome: "Memory" }, title: "Draft" },
      create,
    );

    expect(replay.key).toBe("request-1");
    expect(create).toHaveBeenCalledTimes(1);
    expect(settleDraftRequestIdentity(replay, { kind: "success" })).toBeNull();
  });

  it("creates a new key when content is edited after an ambiguous failure", () => {
    const create = vi.fn().mockReturnValueOnce("request-1").mockReturnValueOnce("request-2");
    const first = getOrCreateDraftRequestIdentity(null, { title: "Original draft" }, create);
    const retained = settleDraftRequestIdentity(first, { kind: "http-error", status: 503 });
    const edited = getOrCreateDraftRequestIdentity(retained, { title: "Edited draft" }, create);

    expect(edited.key).toBe("request-2");
    expect(edited.canonicalPayload).not.toBe(first.canonicalPayload);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("clears a key after a definitive non-commit response but retains it after 5xx", () => {
    const identity = getOrCreateDraftRequestIdentity(null, { title: "Draft" }, () => "request-1");

    expect(settleDraftRequestIdentity(identity, { kind: "http-error", status: 400 })).toBeNull();
    expect(settleDraftRequestIdentity(identity, { kind: "http-error", status: 409 })).toBeNull();
    expect(settleDraftRequestIdentity(identity, { kind: "http-error", status: 500 })).toBe(
      identity,
    );
  });
});
