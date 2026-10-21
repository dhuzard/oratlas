/** Declarative inventory: literal production imports belong only in the G1 test runner. */
export const PROTOCOL_ROUTES = {
  "api/execution-passports/[id]": "@/app/api/execution-passports/[id]/route",
  "api/verification-runs/[id]": "@/app/api/verification-runs/[id]/route",
  "api/verification-runs/[id]/findings": "@/app/api/verification-runs/[id]/findings/route",
  "api/verification-artifacts/[id]/content": "@/app/api/verification-artifacts/[id]/content/route",
  "api/publication-versions/[id]/verifications":
    "@/app/api/publication-versions/[id]/verifications/route",
  "api/certification-results/[id]": "@/app/api/certification-results/[id]/route",
  "api/publication-versions/[id]/certifications":
    "@/app/api/publication-versions/[id]/certifications/route",
} as const;
export const PROTOCOL_WORKER_ONLY_ROUTES = {
  "api/verification-runs/[id]/input": "@/app/api/verification-runs/[id]/input/route",
  "api/verification-runs/[id]/source-artifacts/[artifactId]":
    "@/app/api/verification-runs/[id]/source-artifacts/[artifactId]/route",
  "api/certification-runs/[id]": "@/app/api/certification-runs/[id]/route",
  "api/certification-runs/[id]/input": "@/app/api/certification-runs/[id]/input/route",
} as const;
export type ProtocolRoute = keyof typeof PROTOCOL_ROUTES | keyof typeof PROTOCOL_WORKER_ONLY_ROUTES;
export type ProtocolRouteLoaders = {
  readonly [K in ProtocolRoute]: () => Promise<Record<string, unknown>>;
};
export function bindProtocolRoutes<T extends ProtocolRouteLoaders>(loaders: T): T {
  const keys = Object.keys(loaders).sort();
  const expected = Object.keys({ ...PROTOCOL_ROUTES, ...PROTOCOL_WORKER_ONLY_ROUTES }).sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected))
    throw new Error("Protocol loaders must match exactly the reviewed route keys.");
  return loaders;
}
export const PROTOCOL_FIXTURE_COUNT_DELTAS = {
  ExecutionPassport: 5,
  ExecutionPassportClaim: 5,
  ExecutionPassportArtifact: 10,
  VerificationRun: 1,
  VerificationRunLifecycleEvent: 4,
  VerificationArtifact: 4,
  VerificationArtifactBlob: 3,
  VerificationFinding: 2,
  VerificationFindingArtifact: 2,
  CertificationRun: 1,
  CertificationResult: 1,
  CertificationLifecycleEvent: 2,
} as const;
/** Exact additional SELECT closure measured under the current-main restricted public role. */
export const PROTOCOL_SELECT_TABLES = [
  "ExecutionPassportArtifact",
  "VerificationRun",
  "VerificationFinding",
  "VerificationArtifact",
  "VerificationArtifactBlob",
  "VerificationRunLifecycleEvent",
  "CertificationRun",
  "CertificationLifecycleEvent",
] as const;
