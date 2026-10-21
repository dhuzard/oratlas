import { PRINCIPAL_LABELS, NO_SESSION, validSession, sha256Text } from "./principals.js";
import type { HttpScenario, HttpExpectation, JsonCheck } from "./scenarios.js";
import type { ProtocolRoute } from "./protocol-routes.js";
export const PROTOCOL_ARTIFACT_TEXT = "Synthetic G1 verification evidence: public.\n";
export const PROTOCOL_PRIVATE_ARTIFACT_CANARY = "G1_PROTOCOL_PRIVATE_ARTIFACT_BYTES";
const json = (pointer: string, equals: unknown): JsonCheck => ({ pointer, equals });
const length = (pointer: string, size: number): JsonCheck => ({ pointer, length: size });
const absent = (pointer: string): JsonCheck => ({ pointer, absent: true });
type Case = {
  id: string;
  route: ProtocolRoute;
  idParam: string;
  artifactId?: string;
  expect: HttpExpectation;
};
const denial = (status: number, code: string, message: string): HttpExpectation => ({
  status,
  denial: { code, message },
});
const notFound = (message: string) => denial(404, "not-found", message);
const verificationRun = "g1-protocol-verification-run";
const checks = [
  PROTOCOL_PRIVATE_ARTIFACT_CANARY,
  '"inputJson"',
  '"leaseTokenHash"',
  '"sourceJson"',
];
function cases(): Case[] {
  const result: Case[] = [
    {
      id: "passport",
      route: "api/execution-passports/[id]",
      idParam: "g1-protocol-passport-public",
      expect: {
        status: 200,
        headers: {
          "content-type": "application/vnd.oratlas.execution-passport.v1+json; charset=utf-8",
          "x-content-type-options": "nosniff",
          "cache-control": "no-store, must-revalidate",
        },
        json: [
          json("/status", "execution-attested"),
          json("/verification/signature", "verified"),
          json("/claims/0/versionId", "g1-version-4"),
          json("/claims/0/localClaimId", "claim-1"),
          length("/artifacts", 2),
          json("/workflow/runId", "42"),
        ],
        bodyIncludes: ["does not mean the workflow was rerun"],
        bodyExcludes: checks,
      },
    },
    {
      id: "run",
      route: "api/verification-runs/[id]",
      idParam: verificationRun,
      expect: {
        status: 200,
        json: [
          json("/id", verificationRun),
          json("/subject/publicationVersionId", "g1-discovery-version"),
          json("/status", "completed"),
          json("/protocol/id", "g1-verification-protocol-editorial"),
          json("/verifier/id", "g1-verifier-editorial"),
          length("/findings", 2),
          length("/artifacts", 3),
          length("/lifecycle", 4),
          json("/lifecycle/0/kind", "requested"),
          json("/lifecycle/3/kind", "completed"),
          absent("/inputJson"),
          absent("/leaseTokenHash"),
        ],
        bodyIncludes: [
          "does not establish universal scientific truth",
          "not, by itself, independent reproduction",
        ],
        bodyExcludes: checks,
      },
    },
    {
      id: "findings",
      route: "api/verification-runs/[id]/findings",
      idParam: verificationRun,
      expect: {
        status: 200,
        json: [
          json("/verificationRunId", verificationRun),
          length("/findings", 2),
          json("/findings/0/status", "unverifiable"),
          json("/findings/1/status", "discrepancy"),
          json("/findings/0/submittedByVerifierId", "g1-verifier-editorial"),
          json("/findings/0/artifactRefs/0", "g1-protocol-artifact-public"),
        ],
        bodyExcludes: checks,
      },
    },
    {
      id: "artifact",
      route: "api/verification-artifacts/[id]/content",
      idParam: "g1-protocol-artifact-public",
      expect: {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, immutable, max-age=31536000",
          "content-length": String(Buffer.byteLength(PROTOCOL_ARTIFACT_TEXT)),
          "x-oratlas-sha256": sha256Text(PROTOCOL_ARTIFACT_TEXT),
        },
        bodyEquals: PROTOCOL_ARTIFACT_TEXT,
        bodyExcludes: [PROTOCOL_PRIVATE_ARTIFACT_CANARY],
      },
    },
    {
      id: "verifications",
      route: "api/publication-versions/[id]/verifications",
      idParam: "g1-discovery-version",
      expect: {
        status: 200,
        json: [
          json("/publicationVersionId", "g1-discovery-version"),
          length("/runs", 1),
          json("/runs/0/id", verificationRun),
          json("/summary/statistics/unverifiable", 1),
          json("/summary/statistics/discrepancy", 1),
          absent("/summary/statistics/verified"),
        ],
        bodyExcludes: checks,
      },
    },
    {
      id: "result",
      route: "api/certification-results/[id]",
      idParam: "g1-protocol-certification-result",
      expect: {
        status: 200,
        json: [
          json("/publicationVersionId", "g1-discovery-version"),
          json("/certificationRunId", "g1-protocol-certification-run"),
          json("/certifier/id", "g1-certifier-ora"),
          json("/protocol/id", "g1-certification-protocol-editorial"),
          json("/outcome", "inconclusive"),
          json("/assessmentMode", "human"),
          json("/independence/declared", false),
          length("/criteria", 1),
          length("/lifecycle", 2),
          json("/lifecycle/1/kind", "withdrawn"),
        ],
        bodyExcludes: checks,
      },
    },
    {
      id: "certifications",
      route: "api/publication-versions/[id]/certifications",
      idParam: "g1-discovery-version",
      expect: {
        status: 200,
        json: [
          json("/publicationVersionId", "g1-discovery-version"),
          length("/certifications", 1),
          json("/certifications/0/id", "g1-protocol-certification-result"),
          json("/certifications/0/outcome", "inconclusive"),
          json("/certifications/0/lifecycleState", "withdrawn"),
          json("/certifications/0/protocol/version", "1.0.0"),
        ],
        bodyExcludes: checks,
      },
    },
  ];
  const missingMessages = [
    "Execution passport not found.",
    "Verification run not found.",
    "Verification run not found.",
    "Completed verification artifact not found.",
    "Publication version not found.",
    "Certification result not found.",
    "Publication version not found.",
  ];
  for (const [i, entry] of [...result].entries())
    result.push({
      ...entry,
      id: entry.id + "-missing",
      idParam: "g1-protocol-missing",
      expect: notFound(missingMessages[i]!),
    });
  for (const state of ["hidden", "tombstoned", "tampered", "unknown-key"])
    result.push({
      id: "passport-" + state,
      route: "api/execution-passports/[id]",
      idParam: "g1-protocol-passport-" + state,
      expect: {
        ...notFound("Execution passport not found."),
        bodyExcludes: [
          "Control claim that must stay hidden.",
          "Tombstoned discovery claim must never escape.",
        ],
      },
    });
  result.push({
    id: "artifact-private",
    route: "api/verification-artifacts/[id]/content",
    idParam: "g1-protocol-artifact-private",
    expect: {
      ...denial(401, "unauthorized", "Private artifact access requires verifier authentication."),
      bodyExcludes: [PROTOCOL_PRIVATE_ARTIFACT_CANARY],
    },
  });
  result.push({
    id: "artifact-prepared",
    route: "api/verification-artifacts/[id]/content",
    idParam: "g1-protocol-artifact-prepared",
    expect: notFound("Completed verification artifact not found."),
  });
  result.push({
    id: "artifact-tampered",
    route: "api/verification-artifacts/[id]/content",
    idParam: "g1-protocol-artifact-tampered",
    expect: denial(409, "conflict", "Stored artifact failed its integrity check."),
  });
  for (const suffix of ["verifications", "certifications"] as const)
    result.push({
      id: suffix + "-empty-existing",
      route: `api/publication-versions/[id]/${suffix}`,
      idParam: "g1-publication-version-1",
      expect: {
        status: 200,
        json: [
          json("/publicationVersionId", "g1-publication-version-1"),
          length(suffix === "verifications" ? "/runs" : "/certifications", 0),
        ],
      },
    });
  for (const route of [
    "api/verification-runs/[id]/input",
    "api/verification-runs/[id]/source-artifacts/[artifactId]",
    "api/certification-runs/[id]",
    "api/certification-runs/[id]/input",
  ] as const) {
    const verifier = route.includes("verification-runs");
    result.push({
      id: "worker-" + route.replaceAll("/", "-").replaceAll("[", "").replaceAll("]", ""),
      route,
      idParam: verifier ? verificationRun : "g1-protocol-certification-run",
      ...(route.includes("source-artifacts") ? { artifactId: "g1-discovery-source" } : {}),
      expect: denial(
        401,
        "unauthorized",
        verifier
          ? "A valid verifier bearer credential is required."
          : "A valid certifier bearer credential is required.",
      ),
    });
  }
  return result;
}
/** Public user cookies confer no worker credential/lease. No worker-positive operation is claimed. */
export function publicProtocolScenarios(): readonly HttpScenario[] {
  return PRINCIPAL_LABELS.flatMap((principal) =>
    cases().map((entry) => {
      const key = principal.toLowerCase().replace("+", "-and-");
      const path =
        "/" +
        entry.route.replace("[id]", entry.idParam).replace("[artifactId]", entry.artifactId ?? "");
      return {
        kind: "http" as const,
        id: `protocol-${entry.id}-${key}`,
        method: "GET" as const,
        route: entry.route,
        path,
        params: {
          id: entry.idParam,
          ...(entry.artifactId ? { artifactId: entry.artifactId } : {}),
        },
        principal,
        session: principal === "anonymous" ? NO_SESSION : validSession(principal),
        expect: {
          ...entry.expect,
          ...(principal === "anonymous"
            ? {}
            : { sameResponseAs: `protocol-${entry.id}-anonymous` }),
        },
      };
    }),
  );
}
