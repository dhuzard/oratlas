import { NO_SESSION, PRINCIPAL_LABELS, validSession } from "./principals.js";
import { DISCOVERY_TEXT } from "./discovery-scenarios.js";
import type { HttpScenario, HttpExpectation } from "./scenarios.js";
import {
  WORKER_CREDENTIAL_CASES,
  type WorkerAuthority,
  type WorkerCredentialCase,
} from "./worker-authority.js";

export type WorkerHttpScenario = HttpScenario & {
  readonly workerAuthority: WorkerAuthority;
  readonly params: Readonly<Record<string, string>>;
};
const leaseDenial: HttpExpectation = {
  status: 403,
  denial: {
    code: "forbidden",
    message: "A valid active lease for this verifier and run is required.",
  },
};
const excluded = [
  '"tokenHash"',
  '"leaseTokenHash"',
  '"scopesJson"',
  "oratlas_verify_",
  "oratlas_cert_",
  "oratlas_lease_",
];

function credentialDenial(
  kind: WorkerAuthority["kind"],
  credential: WorkerCredentialCase,
): HttpExpectation | undefined {
  const noun = kind === "verifier" ? "verifier" : "certifier";
  if (credential === "expired" || credential === "revoked")
    return {
      status: 401,
      denial: { code: "unauthorized", message: `The ${noun} credential is revoked or expired.` },
    };
  if (credential === "bad-hash" || credential === "unknown")
    return {
      status: 401,
      denial: { code: "unauthorized", message: `A valid ${noun} bearer credential is required.` },
    };
  if (credential === "inactive")
    return {
      status: 403,
      denial: { code: "forbidden", message: `The ${noun} is not active.` },
    };
  if (credential === "submit-only")
    return {
      status: 403,
      denial: {
        code: "forbidden",
        message: `Credential lacks ${kind === "verifier" ? "verification" : "certification"}:read scope.`,
      },
    };
  if (credential === "wrong-owner")
    return kind === "verifier"
      ? leaseDenial
      : {
          status: 403,
          denial: { code: "forbidden", message: "Certification run belongs to another certifier." },
        };
  return undefined;
}

/** Each user-cookie principal repeats the same independent worker authority matrix. */
export function workerReadScenarios(): WorkerHttpScenario[] {
  return PRINCIPAL_LABELS.flatMap((principal) => {
    const suffix = principal.toLowerCase().replaceAll("+", "-and-");
    const session = principal === "anonymous" ? NO_SESSION : validSession(principal);
    const make = (
      id: string,
      route: string,
      path: string,
      params: Record<string, string>,
      authority: WorkerAuthority,
      expect: HttpExpectation,
    ): WorkerHttpScenario => ({
      kind: "http",
      id: `worker-${id}-${suffix}`,
      route,
      method: "GET",
      path,
      params,
      principal,
      session,
      workerAuthority: authority,
      expect: {
        ...expect,
        bodyExcludes: [...excluded, ...(expect.bodyExcludes ?? [])],
        ...(principal === "anonymous" ? {} : { sameResponseAs: `worker-${id}-anonymous` }),
      },
    });
    const scenarios: WorkerHttpScenario[] = [];
    for (const artifact of [false, true]) {
      const label = artifact ? "verification-source" : "verification-input";
      const route = artifact
        ? "api/verification-runs/[id]/source-artifacts/[artifactId]"
        : "api/verification-runs/[id]/input";
      const target = (
        run = "g1-worker-run-active",
        source = "g1-worker-source",
      ): { path: string; params: Record<string, string> } => ({
        path: `/api/verification-runs/${run}/${artifact ? `source-artifacts/${source}` : "input"}`,
        params: artifact ? { id: run, artifactId: source } : { id: run },
      });
      const positive: HttpExpectation = artifact
        ? {
            status: 200,
            bodyEquals: DISCOVERY_TEXT,
            headers: {
              "content-type": "text/plain",
              "content-length": "71",
              "x-oratlas-sha256":
                "53eb23ed90cbe24de9dcf779876d7a59acca8ab0e0b765bc6701dbede9b34c08",
              "cache-control": "private, no-store",
            },
          }
        : {
            status: 200,
            json: [
              { pointer: "/verificationRunId", equals: "g1-worker-run-active" },
              {
                pointer: "/sha256",
                equals: "29646099c1b6861ec0899ca4fd2dad813e4b9ac799788e051407eb888959236b",
              },
              { pointer: "/schemaVersion", equals: "1.3.0" },
              { pointer: "/input/version/id", equals: "g1-worker-version" },
              { pointer: "/input/occurrences/0/canonicalBinding", equals: null },
              { pointer: "/sourceArtifacts", length: 2 },
              { pointer: "/sourceArtifacts/1/id", equals: "g1-worker-source" },
              { pointer: "/sourceArtifacts/1/available", equals: true },
            ],
          };
      for (const credential of WORKER_CREDENTIAL_CASES) {
        const t = target();
        scenarios.push(
          make(
            `${label}-${credential}`,
            route,
            t.path,
            t.params,
            { kind: "verifier", credential, lease: "active" },
            credentialDenial("verifier", credential) ?? positive,
          ),
        );
      }
      for (const lease of ["missing", "wrong"] as const) {
        const t = target();
        scenarios.push(
          make(
            `${label}-lease-${lease}`,
            route,
            t.path,
            t.params,
            { kind: "verifier", credential: "active", lease },
            leaseDenial,
          ),
        );
      }
      for (const status of ["expired", "terminal"] as const) {
        const t = target(`g1-worker-run-${status}`);
        scenarios.push(
          make(
            `${label}-run-${status}`,
            route,
            t.path,
            t.params,
            { kind: "verifier", credential: "active", lease: "active" },
            leaseDenial,
          ),
        );
      }
      const missing = target("g1-worker-run-missing");
      scenarios.push(
        make(
          `${label}-missing-run`,
          route,
          missing.path,
          missing.params,
          { kind: "verifier", credential: "active", lease: "active" },
          { status: 404, denial: { code: "not-found", message: "Verification run not found." } },
        ),
      );
      if (artifact) {
        const t = target(undefined, "g1-discovery-source");
        scenarios.push(
          make(
            `${label}-out-of-frozen-scope`,
            route,
            t.path,
            t.params,
            { kind: "verifier", credential: "active", lease: "active" },
            {
              status: 403,
              denial: {
                code: "forbidden",
                message: "Source artifact is not explicitly identified by this run's frozen input.",
              },
            },
          ),
        );
      }
    }
    for (const input of [false, true]) {
      const label = input ? "certification-input" : "certification-run";
      const route = `api/certification-runs/[id]${input ? "/input" : ""}`;
      const path = `/api/certification-runs/g1-protocol-certification-run${input ? "/input" : ""}`;
      const positive: HttpExpectation = {
        status: 200,
        json: input
          ? [
              { pointer: "/certificationRunId", equals: "g1-protocol-certification-run" },
              { pointer: "/packetSchemaVersion", equals: "1.3.0" },
              {
                pointer: "/packetSha256",
                equals: "890bdbdfaafb0db8bae2370c838704ff684969413a79160f6e1bd2f89c87bd6e",
              },
              { pointer: "/packet/version/id", equals: "g1-discovery-version" },
              { pointer: "/packet/occurrences", length: 1 },
            ]
          : [
              { pointer: "/id", equals: "g1-protocol-certification-run" },
              { pointer: "/certifierId", equals: "g1-certifier-ora" },
              { pointer: "/status", equals: "completed" },
              { pointer: "/input/packetSchemaVersion", equals: "1.3.0" },
            ],
      };
      for (const credential of WORKER_CREDENTIAL_CASES)
        scenarios.push(
          make(
            `${label}-${credential}`,
            route,
            path,
            { id: "g1-protocol-certification-run" },
            { kind: "certifier", credential },
            credentialDenial("certifier", credential) ?? positive,
          ),
        );
      scenarios.push(
        make(
          `${label}-missing-run`,
          route,
          `/api/certification-runs/g1-worker-run-missing${input ? "/input" : ""}`,
          { id: "g1-worker-run-missing" },
          { kind: "certifier", credential: "active" },
          { status: 404, denial: { code: "not-found", message: "Certification run not found." } },
        ),
      );
    }
    return scenarios;
  });
}

/** Additional rows after the six reviewed base fixtures, in a fresh supplemental reset only. */
export const WORKER_READ_FIXTURE_DELTAS = {
  Publication: 1,
  PublicationVersion: 1,
  PublicationCapture: 2,
  PublicationVersionContributor: 1,
  PublicationProductionAssertion: 1,
  PublicationClaimOccurrence: 1,
  Verifier: 3,
  Certifier: 2,
  VerifierCredential: 6,
  CertifierCredential: 6,
  VerificationRun: 3,
  VerificationRunLifecycleEvent: 10,
} as const;
export const WORKER_READ_FIXTURE_FILES = [
  "worker-source-fixtures.sql",
  "worker-fixtures.sql",
] as const;
