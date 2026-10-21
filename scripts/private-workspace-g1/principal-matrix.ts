import { FIXTURE_USERS, validSession } from "./principals.js";
import type { HttpScenario, Scenario } from "./scenarios.js";

const PUBLIC_BASELINE_ROUTES = new Set([
  "api/health/ready",
  "api/health",
  "api/feeds/atom",
  "api/feeds/lifecycle",
  "llms.txt",
  "openapi.yaml",
  "openapi.json",
  "api/search",
  "api/claims",
  "api/graph",
]);

/** Reuse reviewed public GET assertions under each real session, not a generic empty request. */
export function publicPrincipalScenarios(baseline: readonly Scenario[]): HttpScenario[] {
  return baseline.flatMap((scenario) => {
    if (
      scenario.kind !== "http" ||
      scenario.method !== "GET" ||
      scenario.principal !== "anonymous" ||
      !PUBLIC_BASELINE_ROUTES.has(scenario.route)
    )
      return [];
    return FIXTURE_USERS.map(({ label }) => ({
      ...scenario,
      id: `matrix-${scenario.id}-${label.toLowerCase().replace("+", "-and-")}`,
      principal: label,
      session: validSession(label),
      expect: {
        ...scenario.expect,
        // Graph has an intentionally decrementing per-request RateLimit-Remaining.
        // Keep its exact headers in before/after captures; do not normalize them.
        ...(scenario.route === "api/graph" ? {} : { sameResponseAs: scenario.id }),
      },
    }));
  });
}
