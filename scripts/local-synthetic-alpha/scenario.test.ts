import { describe, expect, it } from "vitest";
import { createHarness } from "./harness.js";
import {
  defineSyntheticScenario,
  isBrandedSyntheticScenario,
  SYNTHETIC_ALPHA_SCENARIO,
  SyntheticScenarioError,
  type SyntheticScenario,
} from "./scenario.js";

const validCase = {
  kind: "http",
  domain: "alpha",
  store: "allow",
  gated: [],
  body: "synthetic record",
  transportFault: "none",
};

function scenarioWith(caseValue: unknown): unknown {
  return { name: "probe", cases: { "probe-case": caseValue } };
}

describe("frozen synthetic scenario", () => {
  it("is deep-frozen inert data and branded", () => {
    expect(isBrandedSyntheticScenario(SYNTHETIC_ALPHA_SCENARIO)).toBe(true);
    expect(Object.isFrozen(SYNTHETIC_ALPHA_SCENARIO)).toBe(true);
    expect(Object.isFrozen(SYNTHETIC_ALPHA_SCENARIO.cases)).toBe(true);
    for (const spec of Object.values(SYNTHETIC_ALPHA_SCENARIO.cases)) {
      expect(Object.isFrozen(spec)).toBe(true);
      expect(Object.isFrozen(spec.gated)).toBe(true);
      for (const value of Object.values(spec)) expect(typeof value).not.toBe("function");
    }
  });

  it("copies its input, so later mutation of the caller's object cannot reach it", () => {
    const input = { name: "probe", cases: { "probe-case": { ...validCase, gated: ["store"] } } };
    const scenario = defineSyntheticScenario(input);
    input.cases["probe-case"].body = "changed";
    input.cases["probe-case"].gated.push("pre-boundary");
    expect(scenario.cases["probe-case"]).toMatchObject({
      body: "synthetic record",
      gated: ["store"],
    });
  });

  it.each([
    ["a function value", { ...validCase, body: () => "x" }],
    [
      "an accessor",
      Object.defineProperty({ ...validCase }, "body", { get: () => "x", enumerable: true }),
    ],
    ["an unknown key", { ...validCase, url: "http://127.0.0.1/" }],
    ["a missing key", { kind: "http", domain: "alpha", store: "allow", gated: [], body: "x" }],
    ["an unknown domain", { ...validCase, domain: "gamma" }],
    ["an unknown kind", { ...validCase, kind: "callback" }],
    ["an unknown store outcome", { ...validCase, store: "maybe" }],
    ["an http completion stage", { ...validCase, gated: ["completion"] }],
    ["a repeated stage", { ...validCase, gated: ["store", "store"] }],
    ["non-ASCII body text", { ...validCase, body: "synthétique" }],
    ["an empty body", { ...validCase, body: "" }],
    ["a class instance", Object.assign(new (class Probe {})(), validCase)],
  ])("rejects a case with %s", (_label, caseValue) => {
    expect(() => defineSyntheticScenario(scenarioWith(caseValue))).toThrow(SyntheticScenarioError);
  });

  describe("rejects accessors without invoking them", () => {
    let reads = 0;
    const getter = (value: unknown) => ({
      get: () => {
        reads += 1;
        return value;
      },
      enumerable: true,
      configurable: true,
    });
    const withGetter = <T extends object>(target: T, key: PropertyKey, value: unknown): T =>
      Object.defineProperty(target, key, getter(value));

    it.each([
      ["a gated array index getter", { ...validCase, gated: withGetter([], 0, "store") }],
      [
        "a gated array index getter beside a data element",
        { ...validCase, gated: withGetter(["store"], 1, "pre-boundary") },
      ],
      ["a case field getter", withGetter({ ...validCase }, "body", "synthetic record")],
      ["a case kind getter", withGetter({ ...validCase }, "kind", "http")],
    ])("%s", (_label, caseValue) => {
      reads = 0;
      expect(() => defineSyntheticScenario(scenarioWith(caseValue))).toThrow(
        SyntheticScenarioError,
      );
      expect(reads).toBe(0);
    });

    it("a getter for a whole case, the case map or the scenario name", () => {
      reads = 0;
      const inputs = [
        { name: "probe", cases: withGetter({}, "probe-case", validCase) },
        withGetter({ name: "probe" }, "cases", { "probe-case": validCase }),
        withGetter({ cases: { "probe-case": validCase } }, "name", "probe"),
      ];
      for (const input of inputs) {
        expect(() => defineSyntheticScenario(input)).toThrow(SyntheticScenarioError);
      }
      expect(reads).toBe(0);
    });
  });

  it.each([
    // eslint-disable-next-line no-sparse-arrays
    ["a hole", [, "store"]],
    ["a preallocated hole", new Array(1)],
    ["an extra named property", Object.assign(["store"], { extra: "store" })],
    ["a symbol property", Object.assign(["store"], { [Symbol("probe")]: "store" })],
    ["an array subclass", Object.assign(new (class Stages extends Array {})(), ["store"])],
    ["a function element", [() => "store"]],
    ["a nested array element", [["store"]]],
    ["too many elements", ["store", "pre-boundary", "store"]],
    [
      "a non-enumerable element",
      Object.defineProperty([], 0, { value: "store", enumerable: false, configurable: true }),
    ],
  ])("rejects gated stages with %s", (_label, gated) => {
    expect(() => defineSyntheticScenario(scenarioWith({ ...validCase, gated }))).toThrow(
      SyntheticScenarioError,
    );
  });

  it.each([
    ["a symbol key", { ...validCase, [Symbol("probe")]: "x" }],
    [
      "a non-enumerable extra key",
      Object.defineProperty({ ...validCase }, "url", { value: "x", enumerable: false }),
    ],
    [
      "a non-enumerable required key",
      Object.defineProperty({ ...validCase }, "body", { value: "x", enumerable: false }),
    ],
  ])("rejects a case with %s", (_label, caseValue) => {
    expect(() => defineSyntheticScenario(scenarioWith(caseValue))).toThrow(SyntheticScenarioError);
  });

  it("rejects invalid case ids and empty scenarios", () => {
    expect(() =>
      defineSyntheticScenario({ name: "probe", cases: { "Bad Id": validCase } }),
    ).toThrow(SyntheticScenarioError);
    expect(() => defineSyntheticScenario({ name: "probe", cases: {} })).toThrow(
      SyntheticScenarioError,
    );
  });

  it("refuses unbranded lookalikes before claiming the owner registry", async () => {
    const clone = JSON.parse(JSON.stringify(SYNTHETIC_ALPHA_SCENARIO)) as SyntheticScenario;
    await expect(createHarness(clone)).rejects.toThrow(/defineSyntheticScenario/u);
    await expect(createHarness(Object.freeze(clone))).rejects.toThrow(/defineSyntheticScenario/u);
  });
});
