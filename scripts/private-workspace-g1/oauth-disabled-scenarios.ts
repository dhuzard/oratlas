import { PRINCIPAL_LABELS, NO_SESSION, validSession } from "./principals.js";
import type { HttpScenario } from "./scenarios.js";
/** Closed-environment denials only. This never configures, contacts or simulates an OAuth provider. */
export const OAUTH_DISABLED_SCENARIOS: readonly HttpScenario[] = ["start", "callback"].flatMap(
  (operation) =>
    PRINCIPAL_LABELS.map((principal) => ({
      kind: "http" as const,
      id: `oauth-disabled-${operation}-${principal.toLowerCase().replaceAll("+", "-and-")}`,
      route: `api/auth/github/${operation}`,
      method: "GET" as const,
      path: `/api/auth/github/${operation}`,
      principal,
      session: principal === "anonymous" ? NO_SESSION : validSession(principal),
      expect: {
        status: 400,
        denial: { code: "bad-request", message: "GitHub OAuth is not configured." },
        absentHeaders: ["set-cookie", "location"],
      },
    })),
);
