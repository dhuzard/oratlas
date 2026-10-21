import { G1_BASE_URL } from "./capture.js";
import { PRINCIPAL_LABELS, NEGATIVE_SESSIONS, NO_SESSION, validSession } from "./principals.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";
import type { SupplementalProgram } from "./supplemental-channel.js";
import targets from "./fixtures/proposal-resolver-targets.json";
export type ResolverTarget = {
  readonly kind: "protocol" | "monitoring";
  readonly id: string;
  readonly actor: "EDITOR" | "ADMIN";
};
export type ResolverScenario = HttpScenario & {
  readonly params: { readonly id: string };
  readonly target: ResolverTarget;
  readonly changes: boolean;
};
export const RESOLVER_COLUMN_UPDATES = ["ProtocolDriftProposal", "ClaimUpdateProposal"].map(
  (table) => ({
    table,
    columns: ["status", "resolvedById", "resolutionNote", "resolvedAt"] as const,
  }),
);
export const RESOLVER_NOTE = "Synthetic resolution fixture only; no scientific confirmation.";
const denied = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
const headers = {
  "content-type": "application/json",
  origin: G1_BASE_URL,
  "sec-fetch-site": "same-origin",
};
export function resolverBody(target: ResolverTarget) {
  return {
    resolution: target.kind === "protocol" ? "explained" : "resolved-no-action",
    note: RESOLVER_NOTE,
  };
}
export function proposalResolverScenarios(
  targets: readonly ResolverTarget[],
): readonly ResolverScenario[] {
  const result: ResolverScenario[] = [];
  for (const target of targets) {
    const route =
      target.kind === "protocol"
        ? "api/protocols/proposals/[id]/resolve"
        : "api/monitoring/proposals/[id]/resolve";
    const path = (id: string) => `/${route.replace("[id]", id)}`;
    const role = (principal: string) =>
      principal === "anonymous"
        ? denied(401, "unauthorized", "Sign in required.")
        : ["EDITOR", "ADMIN"].includes(principal)
          ? undefined
          : denied(
              403,
              "forbidden",
              target.kind === "protocol"
                ? "Editor role required for protocol reconciliation."
                : "Editor role required to resolve proposals.",
            );
    const add = (
      name: string,
      principal: (typeof PRINCIPAL_LABELS)[number],
      id: string,
      expect: HttpExpectation,
      body: unknown = resolverBody(target),
      requestHeaders = headers,
      changes = false,
    ) =>
      result.push({
        kind: "http",
        id: `resolver-${target.kind}-${target.actor}-${name}-${principal}`,
        route,
        method: "POST",
        path: path(id),
        params: { id },
        target,
        changes,
        principal,
        session: principal === "anonymous" ? NO_SESSION : validSession(principal),
        headers: { ...requestHeaders, "x-g1-case": `${target.kind}-${target.actor}-${name}` },
        body: body as HttpScenario["body"],
        expect: { ...expect, absentHeaders: ["set-cookie", "location"] },
      });
    // Domain-role controls precede the sole intended first resolver, then every principal repeats.
    for (const principal of PRINCIPAL_LABELS.filter((p) => p !== target.actor)) {
      if (principal === "EDITOR" || principal === "ADMIN") continue;
      add("open-forbidden", principal, target.id, role(principal)!);
    }
    add(
      "first",
      target.actor,
      target.id,
      { status: 200, bodyEquals: JSON.stringify({ status: resolverBody(target).resolution }) },
      resolverBody(target),
      headers,
      true,
    );
    for (const principal of PRINCIPAL_LABELS) {
      const conflict =
        target.kind === "protocol"
          ? "Proposal is no longer open."
          : "Proposal not found or already resolved.";
      add("repeat", principal, target.id, role(principal) ?? denied(409, "conflict", conflict));
      add(
        "missing",
        principal,
        "g1-resolver-missing",
        role(principal) ??
          denied(
            target.kind === "protocol" ? 404 : 409,
            target.kind === "protocol" ? "not-found" : "conflict",
            target.kind === "protocol"
              ? "Proposal not found."
              : "Proposal not found or already resolved.",
          ),
      );
      add(
        "invalid",
        principal,
        target.id,
        principal === "anonymous"
          ? role(principal)!
          : denied(400, "bad-request", "Invalid request payload."),
        {},
      );
      add(
        "foreign",
        principal,
        target.id,
        denied(403, "forbidden", "A matching same-origin request is required."),
        resolverBody(target),
        { ...headers, origin: "https://foreign.g1.example" },
      );
    }
    for (const session of NEGATIVE_SESSIONS)
      result.push({
        kind: "http",
        id: `resolver-${target.kind}-${target.actor}-session-${session.case}`,
        route,
        method: "POST",
        path: path(target.id),
        params: { id: target.id },
        target,
        changes: false,
        principal: "anonymous",
        session,
        headers,
        body: resolverBody(target),
        expect: denied(401, "unauthorized", "Sign in required."),
      });
  }
  return result;
}

/** Fixed native fixture rows; independent from every other catalog program's reset. */
export const PROPOSAL_RESOLVER_PROGRAM: SupplementalProgram = {
  name: "proposal-resolvers",
  spec: "proposal-resolvers.g1.spec.ts",
  outVariable: "G1_PROPOSAL_RESOLVER_OUT",
  scenarios: proposalResolverScenarios(targets as readonly ResolverTarget[]),
  fixtures: ["fixtures/proposal-resolver-fixtures.sql"],
  addedRows: {
    ProtocolSnapshot: 1,
    ProtocolDriftProposal: 2,
    CitationStatusRecord: 2,
    ClaimUpdateProposal: 6,
    AuditEvent: 3,
    Notification: 4,
  },
  stateSuffix: ".state.json",
};
