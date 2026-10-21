import { expect, it } from "vitest";
import {
  captureHttp,
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  G1_CAPTURE_VERSION,
  type CapturedRequest,
} from "./capture.js";
import {
  comparePairedCaptures,
  compareWithGolden,
  goldenCandidate,
  validateCapture,
} from "./compare.js";
import { NO_SESSION } from "./principals.js";
import { programProblems, type HttpScenario } from "./scenarios.js";
import { captureFromGolden, readGolden } from "./test-support.js";
import {
  workerAuthorityHeaders,
  workerAuthorityDigests,
  workerAuthoritySecrets,
  type WorkerAuthority,
} from "./worker-authority.js";
import { workerChildOutput, workerRequestProblems } from "./worker-capture-safety.js";
const authority: WorkerAuthority = { kind: "verifier", credential: "active", lease: "active" };
const scenario: HttpScenario = {
  kind: "http",
  id: "synthetic-worker",
  route: "api/verification-runs/[id]/input",
  method: "GET",
  path: "/api/verification-runs/synthetic/input",
  principal: "anonymous",
  session: NO_SESSION,
  workerAuthority: authority,
  expect: { status: 200, json: [{ pointer: "/ok", equals: true }] },
};
const headers = () => new Headers(workerAuthorityHeaders(authority));
const request = (): CapturedRequest => ({
  id: scenario.id,
  method: "GET",
  path: scenario.path,
  headers: {},
  body: null,
  principal: "anonymous",
  sessionCase: "none",
  session: NO_SESSION,
  cookieSha256: null,
  workerAuthority: authority,
  ...workerAuthorityDigests(headers()),
});
const response = () => Response.json({ ok: true });
async function capture() {
  return {
    version: G1_CAPTURE_VERSION,
    label: "baseline",
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records: [await captureHttp(request(), response(), headers())],
  };
}
it("binds actual native dispatch headers independently of persisted recipe digests", async () => {
  await expect(captureHttp(request(), response())).rejects.toThrow(
    "Actual worker dispatch headers required",
  );
  const changed = headers();
  changed.set("authorization", changed.get("authorization")!.replace("Bearer ", "bearer "));
  await expect(captureHttp(request(), response(), changed)).rejects.toThrow(
    "Actual worker dispatch header digest differs",
  );
  changed.set("x-oratlas-verification-lease", "unexpected");
  await expect(captureHttp(request(), response(), changed)).rejects.toThrow();
  await expect(
    captureHttp({ ...request(), authorizationSha256: "0".repeat(64) }, response(), headers()),
  ).rejects.toThrow("Unsafe or invalid worker request evidence");
});
it("distinguishes worker recipes in composite identity while refusing raw header capabilities", () => {
  expect(
    programProblems([
      scenario,
      {
        ...scenario,
        id: "other-worker",
        workerAuthority: { ...authority, credential: "wrong-owner" },
      },
    ]),
  ).toEqual([]);
  expect(programProblems([scenario, { ...scenario, id: "duplicate-worker" }]).join(" ")).toContain(
    "duplicate composite key",
  );
  for (const name of ["Authorization", "COOKIE", "X-Oratlas-Verification-Lease"]) {
    const invalid = { ...scenario, headers: { [name]: "synthetic-private-secret" } };
    const problems = programProblems([invalid]);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(" ")).not.toContain("synthetic-private-secret");
  }
});
it("requires the closed recipe and both optional digests together", () => {
  expect(workerRequestProblems(request())).toEqual([]);
  const {
    workerAuthority: _a,
    authorizationSha256: _b,
    verificationLeaseSha256: _c,
    ...old
  } = request();
  expect(workerRequestProblems(old)).toEqual([]);
  for (const invalid of [
    { ...old, authorizationSha256: null },
    { ...request(), workerAuthority: undefined },
    { ...request(), verificationLeaseSha256: undefined },
    {
      ...request(),
      workerAuthority: { ...authority, secret: "synthetic-private-secret" } as WorkerAuthority,
    },
  ])
    expect(workerRequestProblems(invalid).length).toBeGreaterThan(0);
});
it("roundtrips worker identity through golden and independently rejects altered evidence", async () => {
  const file = await capture();
  const golden = goldenCandidate(file, "synthetic offline control");
  expect(validateCapture(file, [scenario])).toEqual([]);
  expect(compareWithGolden(file, golden, [scenario])).toEqual([]);
  expect(captureFromGolden("baseline", golden)).toEqual(file);
  const altered = {
    ...file,
    records: [
      {
        ...file.records[0]!,
        request: {
          ...request(),
          workerAuthority: { ...authority, credential: "wrong-owner" as const },
        },
      },
    ],
  };
  expect(validateCapture(altered, [scenario]).length).toBeGreaterThan(0);
  expect(comparePairedCaptures(file, altered).length).toBeGreaterThan(0);
  expect(compareWithGolden(altered, golden, [scenario]).length).toBeGreaterThan(0);
});
it("leaves old request and golden shapes entirely without optional worker fields", () => {
  const golden = readGolden();
  const reconstructed = goldenCandidate(captureFromGolden("baseline", golden), golden.review);
  expect(reconstructed).toEqual(golden);
  for (const entry of reconstructed.records)
    for (const key of ["workerAuthority", "authorizationSha256", "verificationLeaseSha256"])
      expect(Object.hasOwn(entry, key)).toBe(false);
});
it("refuses response/log capabilities including other recipes and secret components without echo", async () => {
  const other: WorkerAuthority = { kind: "certifier", credential: "inactive" };
  for (const secret of [
    ...workerAuthoritySecrets(authority),
    ...workerAuthoritySecrets(other),
    "oratlas_verify_abcdefghijkl.syntheticUnknown",
  ]) {
    await expect(captureHttp(request(), new Response(secret), headers())).rejects.toThrow(
      "Worker capability response disclosure refused",
    );
    await expect(
      captureHttp(request(), new Response("ok", { headers: { "x-leak": secret } }), headers()),
    ).rejects.toThrow("Worker capability response disclosure refused");
    const sink = workerChildOutput(`stderr: ${secret}`);
    expect(sink.ok).toBe(false);
    expect(sink.text).not.toContain(secret);
    const file = await capture();
    const encoded = {
      ...file,
      records: [{ ...file.records[0]!, bodyBase64: Buffer.from(secret).toString("base64") }],
    };
    const errors = validateCapture(encoded, [scenario]);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.join(" ")).not.toContain(secret);
    expect(() => goldenCandidate(encoded, "synthetic")).toThrow(
      "Unsafe or invalid worker capture evidence",
    );
  }
  expect(workerChildOutput("safe synthetic output")).toEqual({
    ok: true,
    text: "safe synthetic output",
  });
});

it("refuses malformed scenario capabilities before order or expectation diagnostics can echo them", async () => {
  const file = await capture();
  const golden = goldenCandidate(file, "synthetic control");
  for (const secret of workerAuthoritySecrets(authority)) {
    const invalid = { ...scenario, id: secret };
    for (const problems of [
      validateCapture(file, [invalid]),
      compareWithGolden(file, golden, [invalid]),
    ]) {
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.join(" ")).not.toContain(secret);
    }
  }
});
