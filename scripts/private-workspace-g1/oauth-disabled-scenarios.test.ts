import { expect, it } from "vitest";
import { OAUTH_DISABLED_SCENARIOS } from "./oauth-disabled-scenarios.js";
import { PRINCIPAL_LABELS } from "./principals.js";
import { programProblems } from "./scenarios.js";
it("declares only provider-disabled denials with no redirect or cookie under every user session", () => {
  expect(programProblems(OAUTH_DISABLED_SCENARIOS)).toEqual([]);
  expect(OAUTH_DISABLED_SCENARIOS).toHaveLength(12);
  for (const operation of ["start", "callback"]) {
    const cases = OAUTH_DISABLED_SCENARIOS.filter((s) => s.route.endsWith(operation));
    expect(cases.map((s) => s.principal)).toEqual(PRINCIPAL_LABELS);
    for (const scenario of cases)
      expect(scenario.expect).toEqual({
        status: 400,
        denial: { code: "bad-request", message: "GitHub OAuth is not configured." },
        absentHeaders: ["set-cookie", "location"],
      });
  }
});
