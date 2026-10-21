import { expect, it } from "vitest";
import {
  captureHttp,
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  G1_CAPTURE_VERSION,
  type CaptureFile,
} from "./capture.js";
import { NO_SESSION } from "./principals.js";
import { validateCapture } from "./compare.js";
import type { HttpScenario } from "./scenarios.js";

const native = { code: "not-found", message: "Synthesis not found." };
const scenario = (root = false): HttpScenario => ({
  kind: "http",
  id: "native-synthesis-missing",
  route: "api/syntheses/[slug]",
  method: "GET",
  path: "/api/syntheses/g1-synthesis-missing",
  params: { slug: "g1-synthesis-missing" },
  principal: "anonymous",
  session: NO_SESSION,
  expect: { status: 404, denial: { ...native, ...(root ? { envelope: "root" as const } : {}) } },
});
async function problems(body: unknown, root = false) {
  const request = scenario(root);
  const record = await captureHttp(
    {
      id: request.id,
      method: "GET",
      path: request.path,
      headers: {},
      body: null,
      principal: "anonymous",
      sessionCase: "none",
      session: NO_SESSION,
      cookieSha256: null,
    },
    new Response(JSON.stringify(body), {
      status: 404,
      headers: { "content-type": "application/json" },
    }),
  );
  const capture: CaptureFile = {
    version: G1_CAPTURE_VERSION,
    label: "denial-shape-test",
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    records: [record],
  };
  return validateCapture(capture, [request]);
}
it("keeps the existing nested error envelope as the default", async () => {
  expect(await problems({ error: native })).toEqual([]);
  expect(await problems(native)).toEqual([
    "native-synthesis-missing: /error/code differs from reviewed expectation",
    "native-synthesis-missing: /error/message differs from reviewed expectation",
  ]);
});
it("accepts the native top-level synthesis404 only with its explicit root declaration", async () => {
  expect(await problems(native, true)).toEqual([]);
  expect(await problems({ error: native }, true)).toEqual([
    "native-synthesis-missing: /code differs from reviewed expectation",
    "native-synthesis-missing: /message differs from reviewed expectation",
  ]);
});
it("rejects wrong code or message at the declared path even when the other envelope matches", async () => {
  expect(await problems({ ...native, code: "forbidden", error: native }, true)).toEqual([
    "native-synthesis-missing: /code differs from reviewed expectation",
  ]);
  expect(await problems({ ...native, message: "Wrong message", error: native }, true)).toEqual([
    "native-synthesis-missing: /message differs from reviewed expectation",
  ]);
  expect(await problems({ ...native, error: { ...native, code: "forbidden" } })).toEqual([
    "native-synthesis-missing: /error/code differs from reviewed expectation",
  ]);
  expect(await problems({ ...native, error: { ...native, message: "Wrong message" } })).toEqual([
    "native-synthesis-missing: /error/message differs from reviewed expectation",
  ]);
});
it("never treats a malformed envelope as an alternative successful denial", async () => {
  for (const body of [
    null,
    [],
    { error: null },
    { code: native.code },
    { message: native.message },
  ])
    expect((await problems(body, true)).length).toBeGreaterThan(0);
});
