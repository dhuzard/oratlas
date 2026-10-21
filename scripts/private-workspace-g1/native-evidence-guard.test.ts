import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import type { CapturedRequest } from "./capture.js";
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
