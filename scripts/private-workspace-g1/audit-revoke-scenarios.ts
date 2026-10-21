import { G1_BASE_URL } from "./capture.js";
import { NO_SESSION, PRINCIPAL_LABELS, NEGATIVE_SESSIONS, validSession } from "./principals.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";
import type { SupplementalProgram } from "./supplemental-channel.js";
import { WORKER_READ_FIXTURE_DELTAS } from "./worker-read-scenarios.js";
export const AUDIT_REVOKE_TARGETS = [
  {
    kind: "verifier",
    id: "g1-worker-verifier-revoked",
    ownerId: "g1-worker-verifier-primary",
    action: "verification.credential-revoked",
    detailsKey: "verifierId",
    missingMessage: "Verifier credential not found.",
  },
  {
    kind: "certifier",
    id: "g1-worker-certifier-revoked",
    ownerId: "g1-certifier-ora",
    action: "certification.credential-revoked",
    detailsKey: "certifierId",
    missingMessage: "Credential not found.",
  },
] as const;
export type AuditRevokeScenario = HttpScenario & { readonly params: Readonly<{ id: string }> };
const denied = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
const headers = {
  "content-type": "application/json",
  origin: G1_BASE_URL,
  "sec-fetch-site": "same-origin",
};
const auth = (principal: string): HttpExpectation =>
  principal === "anonymous"
    ? denied(401, "unauthorized", "Sign in required.")
    : denied(403, "forbidden", "Administrator role required.");
export const AUDIT_REVOKE_SCENARIOS: readonly AuditRevokeScenario[] = AUDIT_REVOKE_TARGETS.flatMap(
  (target) => {
    const route = `api/editorial/${target.kind}-credentials/[id]/revoke`;
    const cases = PRINCIPAL_LABELS.flatMap((principal) => {
      const make = (
        name: string,
        id: string,
        expect: HttpExpectation,
        requestHeaders: Readonly<Record<string, string>> = headers,
      ): AuditRevokeScenario => ({
        kind: "http",
        id: `audit-revoke-${target.kind}-${name}-${principal}`,
        route,
        method: "POST",
        path: `/api/editorial/${target.kind}-credentials/${id}/revoke`,
        params: { id },
        body: {},
        principal,
        session: principal === "anonymous" ? NO_SESSION : validSession(principal),
        headers: requestHeaders,
        expect: {
          ...expect,
          headers: { "content-type": "application/json" },
          absentHeaders: ["set-cookie", "location"],
          bodyExcludes: [
            "tokenHash",
            "tokenPrefix",
            "oratlas_verify_",
            "oratlas_cert_",
            "oratlas_lease_",
          ],
        },
      });
      return [
        make(
          "already-revoked",
          target.id,
          principal === "ADMIN" ? { status: 200, bodyEquals: '{"revoked":true}' } : auth(principal),
        ),
        make(
          "missing",
          "g1-audit-revoke-missing",
          principal === "ADMIN" ? denied(404, "not-found", target.missingMessage) : auth(principal),
        ),
        make(
          "missing-origin",
          target.id,
          denied(403, "forbidden", "A matching same-origin request is required."),
          { "content-type": "application/json", "sec-fetch-site": "same-origin" },
        ),
        make(
          "foreign-origin",
          target.id,
          denied(403, "forbidden", "A matching same-origin request is required."),
          { ...headers, origin: "https://foreign.g1.example" },
        ),
        make(
          "cross-site",
          target.id,
          denied(403, "forbidden", "Cross-site mutation requests are refused."),
          { ...headers, "sec-fetch-site": "cross-site" },
        ),
        make(
          "wrong-media",
          target.id,
          denied(415, "unsupported-media-type", "Content-Type application/json is required."),
          { ...headers, "content-type": "text/plain" },
        ),
        make(
          "missing-media",
          target.id,
          denied(415, "unsupported-media-type", "Content-Type application/json is required."),
          { origin: G1_BASE_URL, "sec-fetch-site": "same-origin" },
        ),
      ];
    });
    for (const session of NEGATIVE_SESSIONS)
      cases.push({
        kind: "http",
        id: `audit-revoke-${target.kind}-session-${session.case}`,
        route,
        method: "POST",
        path: `/api/editorial/${target.kind}-credentials/${target.id}/revoke`,
        params: { id: target.id },
        body: {},
        principal: "anonymous",
        session,
        headers,
        expect: {
          ...denied(401, "unauthorized", "Sign in required."),
          headers: { "content-type": "application/json" },
          absentHeaders: ["set-cookie", "location"],
        },
      });
    return cases;
  },
);
/** Unwired descriptor. Native repeated revocation appends two audit events; it is not a no-write replay. */
export const AUDIT_REVOKE_PROGRAM: SupplementalProgram = {
  name: "audit-revocations",
  spec: "audit-revocations.g1.spec.ts",
  outVariable: "G1_AUDIT_REVOKE_OUT",
  scenarios: AUDIT_REVOKE_SCENARIOS,
  fixtures: ["fixtures/worker-source-fixtures.sql", "fixtures/worker-fixtures.sql"],
  addedRows: WORKER_READ_FIXTURE_DELTAS,
  stateSuffix: ".state.json",
};
