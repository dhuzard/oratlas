import { gunzipSync } from "node:zlib";
import { captureFromGolden, readGolden } from "./test-support.js";
import { compareWithGolden } from "./compare.js";
import { nativeEvidenceProblems } from "./native-evidence-safety.js";
import { createHmac, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { CapturedRequest, CaptureFile } from "./capture.js";
import { createNativeEvidenceGuard } from "./native-evidence-guard.js";
import { cookieHeader, validSession, type SessionSigner } from "./principals.js";
// A real HMAC signer supplies capabilities to this unit test; authentication itself is not mocked/tested.
const sign: SessionSigner = (id, key, time) => {
  const p = `${id}.${time}`;
  return `${p}.${createHmac("sha256", key).update(p).digest("base64url")}`;
};
const url = "postgresql://synthetic:synthetic%22database%5Ccomponent@127.0.0.1:55464/synthetic";
it("seeds native recipe/DB fragments before observations and refuses encoded mismatches before diagnostics", async () => {
  const guard = createNativeEvidenceGuard(sign, url),
    cookie = cookieHeader(validSession("ADMIN"), sign)!;
  const value = cookie.slice(cookie.indexOf("=") + 1),
    parts = [
      cookie,
      value,
      value.slice(0, value.lastIndexOf(".")),
      value.slice(value.lastIndexOf(".") + 1),
      decodeURIComponent(new URL(url).password),
    ];
  for (const secret of parts) {
    const unicode = [...secret]
      .map((c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
      .join("");
    let diagnosticReached = false;
    try {
      guard.value({ before: { User: [{ displayName: JSON.stringify({ confidence: secret }) }] } });
      diagnosticReached = true;
    } catch (e) {
      expect(
        e instanceof Error && e.message === "Native evidence capability disclosure refused",
      ).toBe(true);
    }
    expect(diagnosticReached).toBe(false);
    await expect(
      guard.capture(
        {
          id: "safe-negative",
          method: "GET",
          path: "/synthetic",
          headers: {},
          body: null,
          principal: "ADMIN",
          sessionCase: "valid",
          session: validSession("ADMIN"),
          cookieSha256: null,
        },
        new Response('{"confidence":"' + unicode + '"}', {
          headers: { "content-type": "application/json" },
        }),
      ),
    ).rejects.toThrow("Native evidence capability disclosure refused");
  }
  const custom = "oratlas_session=custom-payload.custom-signature";
  guard.cookie(custom);
  expect(() => guard.value({ error: { message: "custom-signature" } })).toThrow(
    "Native evidence capability disclosure refused",
  );
});
it("preserves original public row identities/native capture bytes and guards prefix responses", async () => {
  const guard = createNativeEvidenceGuard(sign, url),
    state = { User: [{ id: "g1-user-admin", role: "ADMIN" }] };
  expect(guard.value(state)).toBe(state);
  const response = new Response('{"public":"unchanged"}', {
    headers: { "content-type": "application/json" },
  });
  expect(await guard.response(response)).toBe(response);
  expect(await response.text()).toBe('{"public":"unchanged"}');
  const h = cookieHeader(validSession("ADMIN"), sign)!;
  await expect(guard.response(new Response(JSON.stringify({ message: h })))).rejects.toThrow(
    "Native evidence capability disclosure refused",
  );
  const failure = new Response(
    new ReadableStream({
      start(controller) {
        controller.error(new Error(h));
      },
    }),
  );
  await expect(guard.response(failure)).rejects.toThrow(
    "Native evidence response observation refused",
  );
  const request: CapturedRequest = {
    id: "safe-positive",
    method: "GET" as const,
    path: "/synthetic",
    headers: {},
    body: null,
    principal: "anonymous",
    sessionCase: "none" as const,
    session: { case: "none" as const },
    cookieSha256: null,
  };
  const captured = await guard.capture(request, new Response('{"public":"unchanged"}'));
  expect(captured.bodyBase64).toBe(Buffer.from('{"public":"unchanged"}').toString("base64"));
  expect(() => createNativeEvidenceGuard(sign, "not a URL")).toThrow(
    "Native evidence guard initialization refused",
  );
  expect(
    guard.value({ session: { case: "malformed", value: "g1-malformed-session-value" } }),
  ).toBeDefined();
});
it("keeps native snapshot/capture guards and validation ahead of retained files", () => {
  const names = [
    "certifier-replays",
    "worker-artifacts",
    "worker-reads",
    "deterministic-posts",
    "known-mutation-probe",
    "synthesis-probe",
    "fresh-removal-probe",
    "editorial-read",
    "public-routes",
  ];
  for (const name of names) {
    const source = readFileSync(new URL(`./${name}.g1.spec.ts`, import.meta.url), "utf8");
    expect(source).toContain("createNativeEvidenceGuard(sign, process.env.DATABASE_URL!)");
    expect(source).not.toMatch(/\bawait captureHttp\(/);
    expect(source).toContain("guard.capture(");
    expect(source.indexOf("expect(validateCapture(")).toBeLessThan(
      source.indexOf("writeFileSync("),
    );
  }
  for (const name of [
    "certifier-replays",
    "worker-artifacts",
    "deterministic-posts",
    "synthesis-probe",
  ]) {
    const source = readFileSync(new URL(`./${name}.g1.spec.ts`, import.meta.url), "utf8");
    expect(source).toMatch(/return guard\.value\((?:result|state)\)/);
  }
});

it("fully inspects the reviewed1177 golden and largest native sidecar under an explicit aggregate budget", () => {
  const guard = createNativeEvidenceGuard(sign, url);
  const capture = captureFromGolden("native-budget-regression");
  expect(capture.records).toHaveLength(1177);
  // Hash-only golden bodies cannot reconstruct the complete native decoded traversal.
  const nativeRaw = gunzipSync(
    readFileSync(new URL("./fixtures/native-evidence-1177-capture.json.gz", import.meta.url)),
    { maxOutputLength: 16 * 1024 * 1024 },
  );
  expect(createHash("sha256").update(nativeRaw).digest("hex")).toBe(
    "c200ae23a710c7ba9cb87d79bae05a024bf70e6e6ba8cb7a87ad86b3c3565e7e ".trim(),
  );
  const nativeCapture: unknown = JSON.parse(nativeRaw.toString("utf8"));
  expect(guard.value(nativeCapture)).toBe(nativeCapture);
  expect(compareWithGolden(nativeCapture, readGolden())).toEqual([]);
  expect(nativeEvidenceProblems(nativeCapture, [])).toEqual([
    "Native evidence inspection bound refused",
  ]);
  const modified = structuredClone(nativeCapture) as CaptureFile;
  const recordIndex = modified.records.findIndex((record) => record.kind === "http");
  expect(recordIndex).toBeGreaterThanOrEqual(0);
  const modifiedRecords = modified.records.map((record, index) =>
    index === recordIndex
      ? {
          ...record,
          bodyBase64: Buffer.from(
            JSON.stringify({ confidence: cookieHeader(validSession("ADMIN"), sign) }),
          ).toString("base64"),
        }
      : record,
  );
  expect(() => guard.value({ ...modified, records: modifiedRecords })).toThrow(
    "Native evidence capability disclosure refused",
  );
  const compressed = readFileSync(
    new URL("./fixtures/native-evidence-largest-sidecar.json.gz", import.meta.url),
  );
  const raw = gunzipSync(compressed, { maxOutputLength: 16 * 1024 * 1024 });
  expect(createHash("sha256").update(raw).digest("hex")).toBe(
    "a370eb1649d8a3e9c53cf7ae1f5559d8f3c9572fecae758c5a4af12f0012fc1e",
  );
  const state: unknown = JSON.parse(raw.toString("utf8"));
  expect(guard.value(state)).toBe(state);
  expect(guard.value([nativeCapture, state])).toHaveLength(2);
  expect(nativeEvidenceProblems(state, [])).toEqual(["Native evidence inspection bound refused"]);
  // No record/envelope/state branch can hide a capability through the larger budget.
  expect(() =>
    guard.value({ ...capture, extra: { message: cookieHeader(validSession("ADMIN"), sign) } }),
  ).toThrow("Native evidence capability disclosure refused");
  expect(() =>
    guard.value([
      capture,
      { state, unexpected: { message: cookieHeader(validSession("ADMIN"), sign) } },
    ]),
  ).toThrow("Native evidence capability disclosure refused");
}, 60_000);
it("retains strict helper and finite aggregate pending/visited bounds", () => {
  expect(nativeEvidenceProblems(Array(125_000).fill(null), [])).toEqual([
    "Native evidence inspection bound refused",
  ]);
  const guard = createNativeEvidenceGuard(sign, url);
  expect(() => guard.value(Array(500_000).fill(null))).toThrow(
    "Native evidence capability disclosure refused",
  );
});
