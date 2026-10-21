import {
  WORKER_CREDENTIAL_CASES,
  workerAuthorityHeaders,
  workerAuthorityDigests,
  workerAuthorityProblems,
  workerAuthoritySecrets,
  type WorkerAuthority,
} from "./worker-authority.js";

export const CAPABILITY_REQUEST_HEADERS = [
  "authorization",
  "cookie",
  "x-oratlas-verification-lease",
] as const;
const knownCapabilities = [
  ...new Set(
    ["verifier", "certifier"]
      .flatMap((kind) =>
        WORKER_CREDENTIAL_CASES.flatMap((credential) =>
          workerAuthoritySecrets({
            kind: kind as WorkerAuthority["kind"],
            credential,
            ...(kind === "verifier" ? { lease: "active" as const } : {}),
          }),
        ),
      )
      .concat(workerAuthoritySecrets({ kind: "verifier", credential: "active", lease: "wrong" })),
  ),
];

/** Includes every recipe, not only scenarios currently present in the master program. */
export function workerOutputProblems(value: string): string[] {
  return knownCapabilities.some((secret) => value.includes(secret)) ||
    /oratlas_(?:verify|cert)_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]+|oratlas_lease_[A-Za-z0-9_-]+/u.test(
      value,
    )
    ? ["Worker capability disclosure refused"]
    : [];
}
export function capabilityHeaderProblems(headers: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(headers).some((key) =>
    CAPABILITY_REQUEST_HEADERS.includes(
      key.toLowerCase() as (typeof CAPABILITY_REQUEST_HEADERS)[number],
    ),
  )
    ? ["Raw request capability header refused"]
    : [];
}
type RequestEvidence = {
  headers: Readonly<Record<string, string>>;
  workerAuthority?: WorkerAuthority;
  authorizationSha256?: string | null;
  verificationLeaseSha256?: string | null;
};

/** All three fields are present together, and are absent entirely for old nonworker requests. */
export function workerRequestProblems(request: RequestEvidence): string[] {
  const problems = capabilityHeaderProblems(request.headers);
  const any = ["workerAuthority", "authorizationSha256", "verificationLeaseSha256"].some((key) =>
    Object.hasOwn(request, key),
  );
  if (!any) return problems;
  if (workerAuthorityProblems(request.workerAuthority).length)
    return [...problems, "Invalid worker request evidence"];
  const authority = request.workerAuthority!;
  const expected = workerAuthorityDigests(new Headers(workerAuthorityHeaders(authority)));
  if (
    !Object.hasOwn(request, "authorizationSha256") ||
    !Object.hasOwn(request, "verificationLeaseSha256") ||
    request.authorizationSha256 !== expected.authorizationSha256 ||
    request.verificationLeaseSha256 !== expected.verificationLeaseSha256
  )
    problems.push("Worker header digest differs from authority recipe");
  return problems;
}

/** Inspect decoded bodies too: JSON-only scans cannot see a token hidden in bodyBase64. */
export function workerCaptureProblems(raw: unknown): string[] {
  const problems = workerOutputProblems(JSON.stringify(raw) ?? "");
  const file = raw as { records?: unknown[]; responses?: unknown[]; version?: unknown } | null;
  const records = [
    ...(Array.isArray(file?.records) ? file.records : []),
    ...(file?.version === 1 && Array.isArray(file.responses)
      ? file.responses.map((row) => ({ ...(row as object), kind: "http", legacy: true }))
      : []),
  ];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const row = record as {
      kind?: string;
      legacy?: boolean;
      request?: RequestEvidence;
      bodyBase64?: string;
      requestHeaders?: RequestEvidence["headers"];
    } & Partial<RequestEvidence>;
    if (row.kind !== "http") continue;
    if (
      row.legacy &&
      row.request &&
      ["workerAuthority", "authorizationSha256", "verificationLeaseSha256"].some((key) =>
        Object.hasOwn(row.request!, key),
      )
    )
      problems.push("Worker authority is unsupported in legacy evidence");
    if (row.request?.headers) problems.push(...workerRequestProblems(row.request));
    else if (row.requestHeaders) {
      const evidence: RequestEvidence = { headers: row.requestHeaders };
      for (const key of [
        "workerAuthority",
        "authorizationSha256",
        "verificationLeaseSha256",
      ] as const)
        if (Object.hasOwn(row, key)) Object.assign(evidence, { [key]: row[key] });
      problems.push(...workerRequestProblems(evidence));
    }
    if (typeof row.bodyBase64 === "string")
      problems.push(
        ...workerOutputProblems(Buffer.from(row.bodyBase64, "base64").toString("utf8")),
      );
  }
  return [...new Set(problems)];
}

/** Pre-persistence log refusal: never turn a redacted leak into a passing sink assertion. */
export function workerChildOutput(raw: string): { ok: boolean; text: string } {
  return workerOutputProblems(raw).length
    ? { ok: false, text: "[g1] refused worker capability in child output\n" }
    : { ok: true, text: raw };
}
