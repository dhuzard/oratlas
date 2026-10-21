import { readFileSync } from "node:fs";
import {
  NO_SESSION,
  NEGATIVE_SESSIONS,
  PRINCIPAL_LABELS,
  validSession,
  type PrincipalLabel,
} from "./principals.js";
import { G1_BASE_URL } from "./capture.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";
import type { SupplementalProgram } from "./supplemental-channel.js";
export const PROTOCOL_POST_INPUTS = JSON.parse(
  readFileSync(new URL("./fixtures/protocol-post-inputs.json", import.meta.url), "utf8"),
) as {
  input: {
    reviewVersionId: string;
    registry: "clinicaltrials-gov";
    sourceUrl: string;
    sourceVersion: string;
    fetchedAt: string;
    payload: {
      protocolSection: {
        identificationModule: { nctId: string; briefTitle: string };
        eligibilityModule: { eligibilityCriteria: string };
        outcomesModule: { primaryOutcomes: Array<{ measure: string }> };
      };
    };
  };
  replay: Record<string, unknown>;
  doi: Array<{ request: Record<string, unknown>; report: Record<string, unknown> }>;
  addedRows: Record<string, number>;
};
const denial = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
const signedOut = denial(401, "unauthorized", "Sign in required.");
const roleDenied = denial(403, "forbidden", "Editor role required for protocol reconciliation.");
const editor = (p: PrincipalLabel) => p === "EDITOR" || p === "ADMIN";
const suffix = (p: string) => p.toLowerCase().replaceAll("+", "-and-");
export function protocolDoiScenarios(): HttpScenario[] {
  const scenarios: HttpScenario[] = [];
  const snapshot = (
    name: string,
    body: unknown,
    domain: HttpExpectation,
    options: { headers?: Record<string, string>; beforeRole?: boolean; beforeAuth?: boolean } = {},
  ) => {
    for (const principal of PRINCIPAL_LABELS) {
      const expect = options.beforeAuth
        ? domain
        : principal === "anonymous"
          ? signedOut
          : options.beforeRole
            ? domain
            : editor(principal)
              ? domain
              : roleDenied;
      scenarios.push({
        kind: "http",
        id: `protocol-post-${name}-${suffix(principal)}`,
        route: "api/protocols/snapshots",
        method: "POST",
        path: "/api/protocols/snapshots",
        principal,
        session: principal === "anonymous" ? NO_SESSION : validSession(principal),
        headers: { "content-type": "application/json", origin: G1_BASE_URL, ...options.headers },
        body,
        expect: {
          ...expect,
          ...(principal === "ADMIN"
            ? { sameResponseAs: `protocol-post-${name}-editor` }
            : principal === "B-only" || principal === "A+B"
              ? { sameResponseAs: `protocol-post-${name}-a-only` }
              : {}),
          bodyExcludes: ["oratlas_verify_", "oratlas_cert_", "oratlas_lease_"],
        },
      });
    }
  };
  const input = PROTOCOL_POST_INPUTS.input;
  snapshot("native-replay", input, {
    status: 200,
    bodyEquals: JSON.stringify(PROTOCOL_POST_INPUTS.replay),
    json: [
      { pointer: "/idempotent", equals: true },
      { pointer: "/proposalsOpened", equals: 0 },
    ],
  });
  snapshot(
    "immutable-source-collision",
    {
      ...input,
      payload: {
        ...input.payload,
        protocolSection: {
          ...input.payload.protocolSection,
          identificationModule: {
            ...input.payload.protocolSection.identificationModule,
            briefTitle: "Different synthetic immutable source content",
          },
        },
      },
    },
    denial(
      409,
      "conflict",
      "The same upstream source version was already captured with different content.",
    ),
  );
  snapshot(
    "source-url-mismatch",
    {
      ...input,
      payload: {
        ...input.payload,
        protocolSection: {
          ...input.payload.protocolSection,
          identificationModule: {
            ...input.payload.protocolSection.identificationModule,
            nctId: "NCT09999992",
          },
        },
      },
    },
    denial(
      400,
      "bad-request",
      "Registry URL does not identify the source id declared by the registry payload.",
    ),
  );
  snapshot(
    "missing-version",
    { ...input, reviewVersionId: "g1-protocol-post-missing" },
    denial(404, "not-found", "Review version not found."),
  );
  snapshot(
    "missing-claim",
    { ...input, claimLocalId: "g1-protocol-post-missing" },
    denial(404, "not-found", "Claim not found in the requested review version."),
  );
  snapshot("invalid-input", {}, denial(400, "bad-request", "Invalid request payload."), {
    beforeRole: true,
  });
  snapshot(
    "invalid-registry-payload",
    { ...input, payload: {} },
    denial(400, "bad-request", "Invalid request payload."),
  );
  snapshot(
    "foreign-origin",
    input,
    denial(403, "forbidden", "A matching same-origin request is required."),
    { headers: { origin: "https://other.g1.oratlas.example" }, beforeAuth: true },
  );
  snapshot(
    "cross-site",
    input,
    denial(403, "forbidden", "Cross-site mutation requests are refused."),
    { headers: { "sec-fetch-site": "cross-site" }, beforeAuth: true },
  );
  snapshot(
    "wrong-media",
    input,
    denial(400, "bad-request", "Content-Type application/json is required."),
    { headers: { "content-type": "text/plain" }, beforeAuth: true },
  );
  const doi = (name: string, body: unknown, expect: HttpExpectation) => {
    for (const principal of PRINCIPAL_LABELS)
      scenarios.push({
        kind: "http",
        id: `doi-post-${name}-${suffix(principal)}`,
        route: "api/validate-doi",
        method: "POST",
        path: "/api/validate-doi",
        principal,
        session: principal === "anonymous" ? NO_SESSION : validSession(principal),
        headers: { "content-type": "application/json" },
        body,
        expect: {
          ...expect,
          ...(principal === "anonymous" ? {} : { sameResponseAs: `doi-post-${name}-anonymous` }),
        },
      });
  };
  for (const [index, value] of PROTOCOL_POST_INPUTS.doi.entries())
    doi(`local-report-${index}`, value.request, {
      status: 200,
      bodyEquals: JSON.stringify(value.report),
      json: [
        { pointer: "/confidence", equals: "none" },
        { pointer: "/validatedAt", equals: "2026-04-01T00:00:00.000Z" },
      ],
    });
  for (const [name, body] of [
    ["missing", {}],
    ["wrong-type", { doi: 123 }],
    ["wrong-kind", { doi: "10.5555/g1.invalid-kind", expectedKind: "dataset" }],
  ] as const)
    doi(name, body, denial(400, "bad-request", "A DOI is required."));
  for (const session of NEGATIVE_SESSIONS) {
    scenarios.push({
      kind: "http",
      id: `protocol-post-invalid-cookie-${session.case}`,
      route: "api/protocols/snapshots",
      method: "POST",
      path: "/api/protocols/snapshots",
      principal: "anonymous",
      session,
      headers: { "content-type": "application/json", origin: G1_BASE_URL },
      body: input,
      expect: signedOut,
    });
    scenarios.push({
      kind: "http",
      id: `doi-post-invalid-cookie-${session.case}`,
      route: "api/validate-doi",
      method: "POST",
      path: "/api/validate-doi",
      principal: "anonymous",
      session,
      headers: { "content-type": "application/json" },
      body: PROTOCOL_POST_INPUTS.doi[0]!.request,
      expect: {
        status: 200,
        bodyEquals: JSON.stringify(PROTOCOL_POST_INPUTS.doi[0]!.report),
        sameResponseAs: "doi-post-local-report-0-anonymous",
      },
    });
  }
  return scenarios;
}
export const PROTOCOL_DOI_PROGRAM: SupplementalProgram = {
  name: "protocol-doi",
  spec: "protocol-doi.g1.spec.ts",
  outVariable: "G1_PROTOCOL_DOI_OUT",
  scenarios: protocolDoiScenarios(),
  fixtures: ["fixtures/protocol-post-fixtures.sql"],
  addedRows: PROTOCOL_POST_INPUTS.addedRows,
  stateSuffix: ".state.json",
};
