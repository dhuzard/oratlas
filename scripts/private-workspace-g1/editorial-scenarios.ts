import { G1_BASE_URL } from "./capture.js";
import {
  PRINCIPAL_LABELS,
  NO_SESSION,
  validSession,
  sha256Text,
  type PrincipalLabel,
} from "./principals.js";
import type { HttpScenario, JsonCheck, Scenario, StateProjection } from "./scenarios.js";

/** Exact canonical definition bytes used by the synthetic SQL fixtures; no scientific validity. */
export const G1_CERTIFICATION_DEFINITION =
  '{"assessmentModes":["human"],"criteria":[{"allowedStatuses":["pass","fail"],"description":"Synthetic harness criterion only.","evidenceRequired":false,"id":"fixture-completeness","required":true,"title":"Synthetic fixture completeness"}],"outcomes":["inconclusive"],"requireCompleteSections":[]}';
export const G1_VERIFICATION_DEFINITION = '{"fixture":"synthetic-g1-only","version":"1.0.0"}';
export const EDITORIAL_FIXTURE_HASHES = {
  certification: sha256Text(G1_CERTIFICATION_DEFINITION),
  verification: sha256Text(G1_VERIFICATION_DEFINITION),
} as const;

const SAME_ORIGIN_JSON = {
  "content-type": "application/json",
  origin: G1_BASE_URL,
  "sec-fetch-site": "same-origin",
} as const;
const SECRET_FIELDS = ['"tokenHash"', '"tokenPrefix"', '"createdById"', '"credentials"'];
const slug = (label: PrincipalLabel) => label.toLowerCase().replace("+", "-and-");
const unauthorized = { code: "unauthorized", message: "Sign in required." } as const;
const forbidden = { code: "forbidden", message: "Administrator role required." } as const;

function http(scenario: Omit<HttpScenario, "kind" | "session">): HttpScenario {
  return {
    kind: "http",
    ...scenario,
    session: scenario.principal === "anonymous" ? NO_SESSION : validSession(scenario.principal),
  };
}

type Registry = {
  key: string;
  collection: string;
  list: string;
  detail: string;
  target: string;
  ids: readonly string[];
  checks: readonly JsonCheck[];
  missing: string;
};
const REGISTRIES: readonly Registry[] = [
  {
    key: "certifiers",
    collection: "certifiers",
    list: "api/certifiers",
    detail: "api/certifiers/[id]",
    target: "g1-certifier-ora",
    ids: ["g1-certifier-1", "g1-certifier-ora"],
    checks: [
      { pointer: "/status", equals: "active" },
      { pointer: "/slug", equals: "ora" },
    ],
    missing: "Certifier not found.",
  },
  {
    key: "verifiers",
    collection: "verifiers",
    list: "api/verifiers",
    detail: "api/verifiers/[id]",
    target: "g1-verifier-editorial",
    ids: ["g1-verifier-editorial", "g1-verifier-editorial-control"],
    checks: [
      { pointer: "/status", equals: "active" },
      { pointer: "/slug", equals: "g1-editorial-verifier" },
    ],
    missing: "Verifier not found.",
  },
  {
    key: "certification-protocols",
    collection: "protocols",
    list: "api/certification-protocols",
    detail: "api/certification-protocols/[id]",
    target: "g1-certification-protocol-editorial",
    ids: ["g1-protocol-ora", "g1-certification-protocol-editorial"],
    checks: [
      { pointer: "/status", equals: "active" },
      { pointer: "/certifierId", equals: "g1-certifier-ora" },
      { pointer: "/sha256", equals: EDITORIAL_FIXTURE_HASHES.certification },
      { pointer: "/definition/criteria", length: 1 },
      { pointer: "/definition/assessmentModes", equals: ["human"] },
    ],
    missing: "Certification protocol not found.",
  },
  {
    key: "verification-protocols",
    collection: "protocols",
    list: "api/verification-protocols",
    detail: "api/verification-protocols/[id]",
    target: "g1-verification-protocol-editorial",
    ids: ["g1-verification-protocol-editorial", "g1-verification-protocol-editorial-control"],
    checks: [
      { pointer: "/status", equals: "active" },
      { pointer: "/authorityVerifierId", equals: "g1-verifier-editorial" },
      { pointer: "/definitionSha256", equals: EDITORIAL_FIXTURE_HASHES.verification },
      { pointer: "/definition/fixture", equals: "synthetic-g1-only" },
      { pointer: "/executionMode", equals: "deterministic" },
      { pointer: "/supportedSubjectTypes", equals: ["publication-version"] },
    ],
    missing: "Verification protocol not found.",
  },
];

function registryReads(): HttpScenario[] {
  const scenarios: HttpScenario[] = [];
  for (const registry of REGISTRIES) {
    for (const principal of PRINCIPAL_LABELS) {
      const label = slug(principal);
      for (const kind of ["list", "detail", "missing"] as const) {
        const id = `editorial-${registry.key}-${kind}-${label}`;
        const target = kind === "missing" ? `g1-missing-${registry.key}` : registry.target;
        scenarios.push(
          http({
            id,
            route: kind === "list" ? registry.list : registry.detail,
            method: "GET",
            path: kind === "list" ? `/${registry.list}` : `/${registry.list}/${target}`,
            params: kind === "list" ? undefined : { id: target },
            principal,
            expect:
              kind === "missing"
                ? {
                    status: 404,
                    denial: { code: "not-found", message: registry.missing },
                    ...(principal === "anonymous"
                      ? {}
                      : { sameResponseAs: `editorial-${registry.key}-missing-anonymous` }),
                  }
                : {
                    status: 200,
                    bodyExcludes: SECRET_FIELDS,
                    ...(principal === "anonymous"
                      ? {}
                      : { sameResponseAs: `editorial-${registry.key}-${kind}-anonymous` }),
                    json:
                      kind === "list"
                        ? [
                            { pointer: "/schemaVersion", equals: "1.0.0" },
                            { pointer: `/${registry.collection}`, length: registry.ids.length },
                            ...registry.ids.map((value, index) => ({
                              pointer: `/${registry.collection}/${index}/id`,
                              equals: value,
                            })),
                          ]
                        : [{ pointer: "/id", equals: registry.target }, ...registry.checks],
                  },
          }),
        );
      }
    }
  }
  return scenarios;
}

type AuditEvent = StateProjection["audit"]["events"][number];
type Mutation = {
  key: string;
  route: string;
  target: string;
  body: unknown;
  readRoute: string;
  readPath: string;
  success: readonly JsonCheck[];
  event: AuditEvent;
  missing: string;
};
const MUTATIONS: readonly Mutation[] = [
  {
    key: "verifier-suspend",
    route: "api/editorial/verifiers/[id]/status",
    target: "g1-verifier-editorial",
    body: { status: "suspended" },
    readRoute: "api/verifiers/[id]",
    readPath: "/api/verifiers/g1-verifier-editorial",
    success: [
      { pointer: "/id", equals: "g1-verifier-editorial" },
      { pointer: "/status", equals: "suspended" },
    ],
    event: {
      actorId: "g1-user-admin",
      action: "verification.verifier-status",
      subjectType: "verifier",
      subjectId: "g1-verifier-editorial",
      details: { previous: "active", status: "suspended" },
    },
    missing: "Verifier not found.",
  },
  {
    key: "verification-protocol-retire",
    route: "api/editorial/verification-protocols/[id]/retire",
    target: "g1-verification-protocol-editorial",
    body: {},
    readRoute: "api/verification-protocols/[id]",
    readPath: "/api/verification-protocols/g1-verification-protocol-editorial",
    success: [
      { pointer: "/id", equals: "g1-verification-protocol-editorial" },
      { pointer: "/status", equals: "retired" },
      { pointer: "/definitionSha256", equals: EDITORIAL_FIXTURE_HASHES.verification },
    ],
    event: {
      actorId: "g1-user-admin",
      action: "verification.protocol-retired",
      subjectType: "verification-protocol",
      subjectId: "g1-verification-protocol-editorial",
      details: { definitionSha256: EDITORIAL_FIXTURE_HASHES.verification },
    },
    missing: "Verification protocol not found.",
  },
  {
    key: "certification-protocol-retire",
    route: "api/editorial/certification-protocols/[id]/retire",
    target: "g1-certification-protocol-editorial",
    body: {},
    readRoute: "api/certification-protocols/[id]",
    readPath: "/api/certification-protocols/g1-certification-protocol-editorial",
    success: [
      { pointer: "/id", equals: "g1-certification-protocol-editorial" },
      { pointer: "/status", equals: "retired" },
      { pointer: "/sha256", equals: EDITORIAL_FIXTURE_HASHES.certification },
      { pointer: "/definition/criteria", length: 1 },
    ],
    event: {
      actorId: "g1-user-admin",
      action: "certification.protocol-retired",
      subjectType: "certification-protocol",
      subjectId: "g1-certification-protocol-editorial",
      details: { protocolSha256: EDITORIAL_FIXTURE_HASHES.certification },
    },
    missing: "Certification protocol not found.",
  },
];

/**
 * Append after the shared state-final checkpoint. Preserves its core mutable projection while
 * checking exact audit deltas; public row reads before/after each write prove the persisted state.
 * No external provider, random credential issuance or nondeterministic create path is invoked.
 */
export function editorialScenarios(previousState: StateProjection): Scenario[] {
  const scenarios: Scenario[] = registryReads();
  const events: AuditEvent[] = [...previousState.audit.events];
  const checkpoint = (id: string) => {
    scenarios.push({
      kind: "db-state",
      id,
      expect: {
        ...previousState,
        audit: {
          count: events.length,
          events: [...events].sort((left, right) => {
            const a = `${left.action}|${left.actorId}|${left.subjectId}`;
            const b = `${right.action}|${right.actorId}|${right.subjectId}`;
            return a < b ? -1 : a > b ? 1 : 0;
          }),
        },
      },
    });
  };
  for (const mutation of MUTATIONS) {
    const path = `/api/editorial/${mutation.route.split("/").slice(2).join("/").replace("[id]", mutation.target)}`;
    // Denials all address an existing row and valid body; these are role decisions, not 404/schema errors.
    for (const principal of PRINCIPAL_LABELS.filter((label) => label !== "ADMIN")) {
      scenarios.push(
        http({
          id: `editorial-${mutation.key}-${slug(principal)}`,
          route: mutation.route,
          method: "POST",
          path,
          params: { id: mutation.target },
          headers: SAME_ORIGIN_JSON,
          body: mutation.body,
          principal,
          expect: {
            status: principal === "anonymous" ? 401 : 403,
            denial: principal === "anonymous" ? unauthorized : forbidden,
          },
        }),
      );
    }
    checkpoint(`editorial-state-${mutation.key}-after-denials`);
    const registry = REGISTRIES.find((candidate) => candidate.detail === mutation.readRoute)!;
    for (const principal of PRINCIPAL_LABELS) {
      scenarios.push(
        http({
          id: `editorial-${mutation.key}-unchanged-after-denials-${slug(principal)}`,
          route: mutation.readRoute,
          method: "GET",
          path: mutation.readPath,
          params: { id: mutation.target },
          principal,
          repeatOf: `editorial-${registry.key}-detail-${slug(principal)}`,
          expect: {
            status: 200,
            json: [{ pointer: "/id", equals: mutation.target }, ...registry.checks],
            sameResponseAs: `editorial-${registry.key}-detail-anonymous`,
            bodyExcludes: SECRET_FIELDS,
          },
        }),
      );
    }
    const allowed = http({
      id: `editorial-${mutation.key}-admin`,
      route: mutation.route,
      method: "POST",
      path,
      params: { id: mutation.target },
      headers: SAME_ORIGIN_JSON,
      body: mutation.body,
      principal: "ADMIN",
      expect: { status: 200, json: mutation.success, bodyExcludes: SECRET_FIELDS },
    });
    scenarios.push(allowed);
    events.push(mutation.event);
    checkpoint(`editorial-state-${mutation.key}-after-write`);
    scenarios.push({
      ...allowed,
      id: `editorial-${mutation.key}-admin-repeat`,
      repeatOf: allowed.id,
      expect: { ...allowed.expect, sameResponseAs: allowed.id },
    });
    checkpoint(`editorial-state-${mutation.key}-after-idempotent-repeat`);
    for (const principal of PRINCIPAL_LABELS) {
      scenarios.push(
        http({
          id: `editorial-${mutation.key}-persisted-${slug(principal)}`,
          route: mutation.readRoute,
          method: "GET",
          path: mutation.readPath,
          params: { id: mutation.target },
          principal,
          repeatOf: `editorial-${mutation.key}-unchanged-after-denials-${slug(principal)}`,
          expect: {
            status: 200,
            json: mutation.success,
            bodyExcludes: SECRET_FIELDS,
            ...(principal === "anonymous"
              ? {}
              : { sameResponseAs: `editorial-${mutation.key}-persisted-anonymous` }),
          },
        }),
      );
    }
    for (const principal of PRINCIPAL_LABELS) {
      const targetIndex = registry.ids.indexOf(mutation.target);
      scenarios.push(
        http({
          id: `editorial-${mutation.key}-collection-after-write-${slug(principal)}`,
          route: registry.list,
          method: "GET",
          path: `/${registry.list}`,
          principal,
          repeatOf: `editorial-${registry.key}-list-${slug(principal)}`,
          expect: {
            status: 200,
            bodyExcludes: SECRET_FIELDS,
            ...(principal === "anonymous"
              ? {}
              : { sameResponseAs: `editorial-${mutation.key}-collection-after-write-anonymous` }),
            json: [
              { pointer: `/${registry.collection}`, length: registry.ids.length },
              ...registry.ids.flatMap((id, index) => [
                { pointer: `/${registry.collection}/${index}/id`, equals: id },
                {
                  pointer: `/${registry.collection}/${index}/status`,
                  equals:
                    index === targetIndex
                      ? mutation.key === "verifier-suspend"
                        ? "suspended"
                        : "retired"
                      : "active",
                },
              ]),
            ],
          },
        }),
      );
    }
    scenarios.push(
      http({
        id: `editorial-${mutation.key}-missing-admin`,
        route: mutation.route,
        method: "POST",
        path: path.replace(mutation.target, `g1-missing-${mutation.key}`),
        params: { id: `g1-missing-${mutation.key}` },
        headers: SAME_ORIGIN_JSON,
        body: mutation.body,
        principal: "ADMIN",
        expect: { status: 404, denial: { code: "not-found", message: mutation.missing } },
      }),
    );
    checkpoint(`editorial-state-${mutation.key}-after-missing`);
  }
  return scenarios;
}
