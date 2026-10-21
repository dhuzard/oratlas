import { describe, expect, it } from "vitest";
import { publicPrincipalScenarios } from "./principal-matrix.js";
import { SCENARIOS, type Scenario } from "./scenarios.js";
import { FIXTURE_USERS } from "./principals.js";

describe("public baseline under authenticated principals", () => {
  const baseline = SCENARIOS.slice(
    0,
    SCENARIOS.findIndex((scenario) => scenario.id.startsWith("matrix-")),
  );
  const added = publicPrincipalScenarios(baseline);
  it("uses every reviewed public GET and real signed-session recipes", () => {
    expect(baseline).toHaveLength(14);
    expect(added.length).toBe(70);
    for (const user of FIXTURE_USERS) {
      const own = added.filter((scenario) => scenario.principal === user.label);
      expect(own).toHaveLength(14);
      expect(own.every((scenario) => scenario.session.case === "valid")).toBe(true);
      expect(new Set(own.map((scenario) => scenario.route)).size).toBe(10);
    }
  });
  it("preserves source-specific bodies, pagination and denial controls", () => {
    for (const scenario of added) {
      const source = baseline.find(
        (item) =>
          item.id === scenario.id.slice(7).replace(/-(a-only|b-only|a-and-b|editor|admin)$/u, ""),
      );
      expect(source?.kind).toBe("http");
      if (source?.kind !== "http") throw new Error("source required");
      expect(scenario.path).toBe(source.path);
      expect(scenario.derive).toEqual(source.derive);
      expect(scenario.expect.json).toEqual(source.expect.json);
      expect(scenario.expect.bodyExcludes).toEqual(source.expect.bodyExcludes);
      expect(scenario.expect.status).toBe(source.expect.status);
      if (scenario.route === "api/graph") expect(scenario.expect.sameResponseAs).toBeUndefined();
      else expect(scenario.expect.sameResponseAs).toBe(source.id);
    }
  });
  it("does not copy mutations or user-specific notifications into the public equality matrix", () => {
    const source = baseline.find((scenario) => scenario.kind === "http");
    if (!source || source.kind !== "http") throw new Error("source required");
    const forbidden: Scenario[] = [
      { ...source, method: "POST" },
      { ...source, route: "api/notifications" },
    ];
    expect(publicPrincipalScenarios(forbidden)).toEqual([]);
  });
});
