import { describe, expect, it } from "vitest";
import { canonicalJson } from "./canonical-json.js";

describe("canonicalJson", () => {
  it("sorts keys recursively and preserves array order", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, x: [3, { b: 2, a: 1 }] } })).toBe(
      '{"a":{"x":[3,{"a":1,"b":2}],"y":2},"z":1}',
    );
  });

  it("omits undefined object fields but rejects lossy array and numeric values", () => {
    expect(canonicalJson({ b: undefined, a: 1 })).toBe('{"a":1}');
    expect(() => canonicalJson([undefined])).toThrow(/Unsupported JSON value/);
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/Non-finite/);
    expect(() => canonicalJson({ n: Number.POSITIVE_INFINITY })).toThrow(/Non-finite/);
  });

  it("rejects cycles and non-plain objects", () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => canonicalJson(cycle)).toThrow(/Circular/);
    expect(() => canonicalJson(new Map())).toThrow(/Non-plain/);
  });
});
