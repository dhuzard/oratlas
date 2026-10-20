import {
  atomEntryIds,
  bodyText,
  normalizedHeaders,
  type CaptureFile,
  type CapturedResponse,
} from "./capture.js";

/**
 * Comparators for G1 public captures. Paired comparison proves before/after equality; the golden
 * comparison proves the captures are the reviewed, non-degraded responses (so two identical error
 * responses can never pass as evidence). Only date/request-id headers are normalized.
 */

export type GoldenBody =
  | { readonly encoding: "utf8"; readonly text: string }
  | { readonly sha256: string; readonly length: number };

export type GoldenRoute = {
  readonly id: string;
  readonly method: "GET";
  readonly path: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly status: number;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly setCookie: readonly string[];
  readonly body: GoldenBody;
  readonly atomEntryIds?: readonly string[];
};

export type GoldenFile = {
  readonly version: 1;
  readonly review: string;
  readonly baseUrl: string;
  readonly clock: string;
  readonly routes: readonly GoldenRoute[];
};

/** Bodies at or below this size are stored verbatim in the golden file; larger ones by hash. */
export const GOLDEN_TEXT_LIMIT = 16 * 1024;

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function compareResponse(prefix: string, left: CapturedResponse, right: CapturedResponse) {
  const differences: string[] = [];
  if (!sameJson(left.request, right.request)) differences.push(`${prefix}: request differs`);
  if (left.status !== right.status) {
    differences.push(`${prefix}: status ${left.status} != ${right.status}`);
  }
  if (!sameJson(normalizedHeaders(left), normalizedHeaders(right))) {
    differences.push(`${prefix}: headers differ`);
  }
  if (!sameJson(left.setCookie, right.setCookie)) differences.push(`${prefix}: set-cookie differs`);
  if (left.bodySha256 !== right.bodySha256 || left.bodyBase64 !== right.bodyBase64) {
    differences.push(`${prefix}: body bytes differ`);
  }
  return differences;
}

/** Differences between two captures of the same request list (empty when byte-identical). */
export function comparePairedCaptures(before: CaptureFile, after: CaptureFile): string[] {
  const differences: string[] = [];
  for (const key of ["baseUrl", "clock", "principal"] as const) {
    if (before[key] !== after[key]) differences.push(`capture ${key} differs`);
  }
  const beforeIds = before.responses.map((response) => response.id);
  const afterIds = after.responses.map((response) => response.id);
  if (!sameJson(beforeIds, afterIds)) {
    differences.push(`route list/order differs: ${beforeIds.join(",")} vs ${afterIds.join(",")}`);
    return differences;
  }
  if (beforeIds.length === 0) differences.push("captures are empty");
  before.responses.forEach((response, index) => {
    differences.push(...compareResponse(response.id, response, after.responses[index]!));
  });
  return differences;
}

/** Differences between a capture and the reviewed golden file. */
export function compareWithGolden(capture: CaptureFile, golden: GoldenFile): string[] {
  const differences: string[] = [];
  if (capture.baseUrl !== golden.baseUrl) differences.push("baseUrl differs from golden");
  if (capture.clock !== golden.clock) differences.push("clock differs from golden");
  const ids = capture.responses.map((response) => response.id);
  const goldenIds = golden.routes.map((route) => route.id);
  if (!sameJson(ids, goldenIds)) {
    differences.push(`route list/order differs from golden: ${ids.join(",")}`);
    return differences;
  }
  if (ids.length === 0) differences.push("golden and capture are empty");
  capture.responses.forEach((response, index) => {
    const route = golden.routes[index]!;
    const prefix = `${route.id} (golden)`;
    if (
      response.request.method !== route.method ||
      response.request.path !== route.path ||
      !sameJson(response.request.headers, route.requestHeaders)
    ) {
      differences.push(`${prefix}: request differs`);
    }
    if (response.status !== route.status) {
      differences.push(`${prefix}: status ${response.status} != ${route.status}`);
    }
    if (route.status >= 400) differences.push(`${prefix}: golden must not record an error status`);
    if (route.status === 200 && response.bodyLength === 0) {
      differences.push(`${prefix}: 200 response has an empty body`);
    }
    if (!sameJson(normalizedHeaders(response), route.headers)) {
      differences.push(`${prefix}: headers differ`);
    }
    if (!sameJson(response.setCookie, route.setCookie)) {
      differences.push(`${prefix}: set-cookie differs`);
    }
    if ("encoding" in route.body) {
      const expected = Buffer.from(route.body.text, "utf8");
      if (!expected.equals(Buffer.from(response.bodyBase64, "base64"))) {
        differences.push(`${prefix}: body bytes differ`);
      }
    } else if (
      response.bodySha256 !== route.body.sha256 ||
      response.bodyLength !== route.body.length
    ) {
      differences.push(`${prefix}: body hash/length differs`);
    }
    if (route.atomEntryIds !== undefined) {
      const entries = atomEntryIds(bodyText(response));
      if (route.atomEntryIds.length === 0) differences.push(`${prefix}: feed golden is empty`);
      if (!sameJson(entries, route.atomEntryIds)) {
        differences.push(`${prefix}: feed entry count/order differs`);
      }
    }
  });
  return differences;
}

/**
 * A golden *candidate* derived from a capture, for human review. The harness never writes it over
 * the reviewed golden file and never accepts it automatically after a failure.
 */
export function goldenCandidate(capture: CaptureFile, review: string): GoldenFile {
  return {
    version: 1,
    review,
    baseUrl: capture.baseUrl,
    clock: capture.clock,
    routes: capture.responses.map((response) => {
      const text = bodyText(response);
      const verbatim =
        response.bodyLength <= GOLDEN_TEXT_LIMIT &&
        Buffer.from(text, "utf8").toString("base64") === response.bodyBase64;
      const isAtom = normalizedHeaders(response).some(
        ([name, value]) => name === "content-type" && value.startsWith("application/atom+xml"),
      );
      return {
        id: response.id,
        method: response.request.method,
        path: response.request.path,
        requestHeaders: response.request.headers,
        status: response.status,
        headers: normalizedHeaders(response),
        setCookie: response.setCookie,
        body: verbatim
          ? { encoding: "utf8" as const, text }
          : { sha256: response.bodySha256, length: response.bodyLength },
        ...(isAtom ? { atomEntryIds: atomEntryIds(text) } : {}),
      };
    }),
  };
}
