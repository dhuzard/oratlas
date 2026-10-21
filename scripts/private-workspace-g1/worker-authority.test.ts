import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  workerAuthorityDigests,
  workerAuthorityHeaders,
  workerAuthorityProblems,
  workerAuthoritySecrets,
  workerAuthorityDisclosureProblems,
  workerCredential,
  workerLease,
  WORKER_READ_COLUMN_UPDATES,
  type WorkerAuthority,
} from "./worker-authority.js";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

it("supplies issuer-shaped synthetic verifier/certifier tokens and exact native stored-token hashes", () => {
  for (const kind of ["verifier", "certifier"] as const) {
    const a = workerCredential(kind, "active");
    expect(a.token).toMatch(/^oratlas_(verify|cert)_[A-Za-z0-9_-]{12}\.[A-Za-z0-9_-]{43}$/u);
    expect(a.tokenHash).toBe(sha(a.token));
    const wrong = workerCredential(kind, "bad-hash");
    expect(wrong.tokenPrefix).toBe(a.tokenPrefix);
    expect(wrong.tokenHash).not.toBe(a.tokenHash);
  }
  expect(workerLease()).toMatch(/^oratlas_lease_[A-Za-z0-9_-]{43}$/u);
  expect(workerLease("wrong")).not.toBe(workerLease());
});
it("binds native dispatched header strings and detects a scheme or lease change", () => {
  const recipe: WorkerAuthority = { kind: "verifier", credential: "active", lease: "active" };
  const headers = new Headers(workerAuthorityHeaders(recipe));
  const expected = workerAuthorityDigests(headers);
  expect(expected.authorizationSha256).toBe(sha(headers.get("authorization")!));
  expect(expected.authorizationSha256).not.toBe(workerCredential("verifier", "active").tokenHash);
  expect(expected.verificationLeaseSha256).toBe(sha(workerLease()));
  headers.set("authorization", headers.get("authorization")!.replace("Bearer ", "bearer "));
  headers.set("x-oratlas-verification-lease", workerLease("wrong"));
  expect(workerAuthorityDigests(headers)).not.toEqual(expected);
  expect(workerAuthorityDigests(new Headers())).toEqual({
    authorizationSha256: null,
    verificationLeaseSha256: null,
  });
});
it("omits lease only for declared missing verifier lease or certifier authority", () => {
  for (const recipe of [
    { kind: "verifier", credential: "active", lease: "missing" },
    { kind: "certifier", credential: "active" },
  ] as const) {
    const headers = new Headers(workerAuthorityHeaders(recipe));
    expect(headers.has("authorization")).toBe(true);
    expect(workerAuthorityDigests(headers).verificationLeaseSha256).toBeNull();
  }
});
it("fails closed on unknown fields/kinds/cases without echoing supplied secret values", () => {
  for (const value of [
    null,
    [],
    {},
    { kind: "verifier", credential: "private-secret" },
    { kind: "certifier", credential: "active", lease: "active" },
    { kind: "verifier", credential: "active", token: "private-secret" },
  ]) {
    expect(workerAuthorityProblems(value)).toEqual(["Invalid worker authority recipe"]);
    expect(() => workerAuthorityHeaders(value as WorkerAuthority)).toThrow(
      "Invalid worker authority recipe",
    );
  }
});
it("provides full capabilities and their secret components for body/log exclusion, never hashes", () => {
  const recipe: WorkerAuthority = { kind: "verifier", credential: "active", lease: "active" };
  const secrets = workerAuthoritySecrets(recipe);
  const token = workerCredential("verifier", "active").token;
  expect(secrets).toContain(`Bearer ${token}`);
  expect(secrets).toContain(token);
  expect(secrets).toContain(token.split(".")[1]);
  expect(secrets).toContain(workerLease());
  expect(secrets).toContain(workerLease().slice("oratlas_lease_".length));
  expect(secrets).not.toContain(sha(token));
  for (const value of secrets)
    expect(workerAuthorityDisclosureProblems(`unexpected ${value}`, recipe)).toEqual([
      "Worker capability in captured output",
    ]);
  expect(WORKER_READ_COLUMN_UPDATES.map((row) => [row.table, row.columns])).toEqual([
    ["CertifierCredential", ["lastUsedAt"]],
    ["VerifierCredential", ["lastUsedAt"]],
  ]);
});

it("extends submit authority without changing the reviewed eight-case read matrix or disclosure coverage", async () => {
  const { WORKER_CREDENTIAL_CASES, KNOWN_WORKER_CREDENTIAL_CASES } =
    await import("./worker-authority.js");
  const { workerOutputProblems } = await import("./worker-capture-safety.js");
  expect(WORKER_CREDENTIAL_CASES).toHaveLength(8);
  expect(KNOWN_WORKER_CREDENTIAL_CASES).toHaveLength(9);
  const recipe = { kind: "verifier", credential: "wrong-owner-submit", lease: "active" } as const;
  expect(workerAuthorityProblems(recipe)).toEqual([]);
  expect(workerCredential("verifier", "wrong-owner-submit").tokenHash).not.toBe(
    workerCredential("verifier", "wrong-owner").tokenHash,
  );
  for (const value of workerAuthoritySecrets(recipe))
    expect(workerOutputProblems(value)).toEqual(["Worker capability disclosure refused"]);
});
