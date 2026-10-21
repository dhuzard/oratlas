import { describe, expect, it } from "vitest";
import { PermitAuthority, type PermitBinding } from "./permits.js";

// Standalone authorities only: these tests obtain no harness capability. The inert `effects`
// counter stands in for an effect boundary that acts only on an accepted permit.
const binding: PermitBinding = {
  domain: "alpha",
  generation: 1,
  operationId: "op-1",
  kind: "http-release",
};

function boundary(authority: PermitAuthority) {
  let effects = 0;
  return {
    present(candidate: unknown, expected: PermitBinding = binding) {
      const verdict = authority.consume(candidate, expected);
      if (verdict === "accepted") effects += 1;
      return verdict;
    },
    effects: () => effects,
  };
}

describe("single-use synthetic permits", () => {
  it("accepts a matching permit exactly once and rejects its replay", () => {
    const authority = new PermitAuthority();
    const sink = boundary(authority);
    const permit = authority.mint(binding);
    expect(sink.present(permit)).toBe("accepted");
    expect(sink.present(permit)).toBe("replayed");
    expect(sink.effects()).toBe(1);
  });

  it("rejects forged lookalikes and permits from another authority", () => {
    const authority = new PermitAuthority();
    const other = new PermitAuthority();
    const sink = boundary(authority);
    const foreign = other.mint(binding);
    for (const candidate of [
      {},
      Object.freeze(Object.create(null) as object),
      { ...authority.mint(binding) },
      foreign,
      null,
      undefined,
      "permit",
      1,
    ]) {
      expect(sink.present(candidate)).toBe("forged");
    }
    expect(sink.effects()).toBe(0);
    // The foreign permit is still unspent for its own authority: nothing crossed over.
    expect(other.consume(foreign, binding)).toBe("accepted");
  });

  it.each([
    ["wrong-domain", { domain: "beta" }],
    ["wrong-operation", { operationId: "op-2" }],
    ["wrong-kind", { kind: "provider-start" }],
    ["wrong-generation", { generation: 2 }],
  ] as const)("rejects %s and burns the permit on that presentation", (verdict, change) => {
    const authority = new PermitAuthority();
    const sink = boundary(authority);
    const permit = authority.mint(binding);
    expect(sink.present(permit, { ...binding, ...change })).toBe(verdict);
    // A mismatched presentation cannot be retried with the right expectation.
    expect(sink.present(permit, binding)).toBe("replayed");
    expect(sink.effects()).toBe(0);
  });

  it("mints opaque, frozen tokens that carry no readable binding", () => {
    const permit = new PermitAuthority().mint(binding);
    expect(Object.isFrozen(permit)).toBe(true);
    expect(Reflect.ownKeys(permit)).toEqual([]);
    expect(Object.getPrototypeOf(permit)).toBeNull();
  });
});
