import { createHash } from "node:crypto";

export const WORKER_CREDENTIAL_CASES = [
  "active",
  "wrong-owner",
  "submit-only",
  "expired",
  "revoked",
  "inactive",
  "bad-hash",
  "unknown",
] as const;
/** Preserve the reviewed read program while extending the finite dispatch/secret inventory. */
export const KNOWN_WORKER_CREDENTIAL_CASES = [
  ...WORKER_CREDENTIAL_CASES,
  "wrong-owner-submit",
] as const;
export type WorkerCredentialCase = (typeof KNOWN_WORKER_CREDENTIAL_CASES)[number];
export interface WorkerAuthority {
  readonly kind: "verifier" | "certifier";
  readonly credential: WorkerCredentialCase;
  readonly lease?: "active" | "missing" | "wrong";
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const secret = (value: string) => createHash("sha256").update(value).digest("base64url");

export function workerAuthorityProblems(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return ["Invalid worker authority recipe"];
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => !["kind", "credential", "lease"].includes(key)) ||
    !["verifier", "certifier"].includes(row.kind as string) ||
    !KNOWN_WORKER_CREDENTIAL_CASES.includes(row.credential as WorkerCredentialCase) ||
    (row.lease !== undefined &&
      (row.kind !== "verifier" || !["active", "missing", "wrong"].includes(row.lease as string)))
  )
    return ["Invalid worker authority recipe"];
  return [];
}

/** Publicly reproducible synthetic test inputs, never usable outside disposable seeded targets. */
export function workerCredential(kind: WorkerAuthority["kind"], recipe: WorkerCredentialCase) {
  const storedCase = recipe === "bad-hash" ? "active" : recipe;
  const key = `oratlas-g1-worker/${kind}/${storedCase}`;
  const tokenPrefix = secret(`${key}/prefix`).slice(0, 12);
  const token = `oratlas_${kind === "verifier" ? "verify" : "cert"}_${tokenPrefix}.${secret(`${key}/${recipe === "bad-hash" ? "wrong-secret" : "secret"}`)}`;
  return { token, tokenPrefix, tokenHash: hash(token) };
}
export function workerLease(which: "active" | "wrong" = "active") {
  return `oratlas_lease_${secret(`oratlas-g1-worker/lease/${which}`)}`;
}

/** Dispatch-only headers. They must never be copied into captured request.headers. */
export function workerAuthorityHeaders(authority: WorkerAuthority): Record<string, string> {
  if (workerAuthorityProblems(authority).length) throw new Error("Invalid worker authority recipe");
  return {
    authorization: `Bearer ${workerCredential(authority.kind, authority.credential).token}`,
    ...(authority.kind === "verifier" && authority.lease !== "missing"
      ? {
          "x-oratlas-verification-lease": workerLease(
            authority.lease === "wrong" ? "wrong" : "active",
          ),
        }
      : {}),
  };
}

/** Assert absence from bodies/logs; never persist this list or leak its values in error messages. */
export function workerAuthoritySecrets(authority: WorkerAuthority): string[] {
  const headers = workerAuthorityHeaders(authority);
  const token = headers.authorization!.slice("Bearer ".length);
  const lease = headers["x-oratlas-verification-lease"];
  return [
    headers.authorization!,
    token,
    token.split(".")[1]!,
    ...(lease ? [lease, lease.slice("oratlas_lease_".length)] : []),
  ];
}

/** Error codes intentionally never echo capability bytes, even when an actual leak is found. */
export function workerAuthorityDisclosureProblems(
  output: string,
  authority: WorkerAuthority,
): string[] {
  return workerAuthoritySecrets(authority).some((value) => output.includes(value))
    ? ["Worker capability in captured output"]
    : [];
}

/** Bind exact dispatched header strings, including the Bearer scheme, without storing capabilities. */
export function workerAuthorityDigests(headers: Headers) {
  const authorization = headers.get("authorization");
  const lease = headers.get("x-oratlas-verification-lease");
  return {
    authorizationSha256: authorization === null ? null : hash(authorization),
    verificationLeaseSha256: lease === null ? null : hash(lease),
  };
}

export const WORKER_READ_SELECT_TABLES = ["CertifierCredential", "VerifierCredential"] as const;
export const WORKER_READ_COLUMN_UPDATES = [
  { table: "CertifierCredential", columns: ["lastUsedAt"] },
  { table: "VerifierCredential", columns: ["lastUsedAt"] },
] as const;
