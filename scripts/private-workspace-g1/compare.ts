import {
  atomEntryIds,
  bodyText,
  G1_CAPTURE_VERSION,
  LEGACY_CAPTURE_VERSION,
  normalizedHeaders,
  upgradeCapture,
  type CaptureFile,
  type CaptureRecord,
  type HttpRecord,
} from "./capture.js";
import {
  cookieHeader,
  principalSessionProblems,
  sha256Text,
  type SessionSigner,
} from "./principals.js";
import {
  programProblems,
  requestBodyText,
  SCENARIOS,
  type HttpScenario,
  type JsonCheck,
  type Scenario,
} from "./scenarios.js";

/**
 * Comparators for G1 captures. `validateCapture` proves one capture is exactly the reviewed
 * program's outcome (order, principals, sessions, statuses, declared denials, collections, cursor
 * and ETag derivations, controls); paired comparison proves byte equality across resets/runs; the
 * golden comparison proves the captures equal the reviewed bytes. Only date/request-id headers are
 * normalized. Error statuses are evidence only where the program declares that exact denial.
 */

export type GoldenBody =
  | { readonly encoding: "utf8"; readonly text: string }
  | { readonly sha256: string; readonly length: number };

export type GoldenHttpRecord = {
  readonly kind: "http";
  readonly id: string;
  readonly method: HttpRecord["request"]["method"];
  readonly path: string;
  readonly requestHeaders: Readonly<Record<string, string>>;
  readonly requestBody: string | null;
  readonly principal: HttpRecord["request"]["principal"];
  readonly sessionCase: HttpRecord["request"]["sessionCase"];
  readonly session: HttpRecord["request"]["session"];
  readonly cookieSha256: string | null;
  readonly status: number;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly setCookie: readonly string[];
  readonly body: GoldenBody;
  readonly atomEntryIds?: readonly string[];
};

export type GoldenTextRecord = {
  readonly kind: "metadata-loader" | "db-state";
  readonly id: string;
  readonly loader?: string;
  readonly body: GoldenBody;
};

export type GoldenRecord = GoldenHttpRecord | GoldenTextRecord;

export type GoldenFile = {
  readonly version: typeof G1_CAPTURE_VERSION;
  readonly review: string;
  readonly baseUrl: string;
  readonly clock: string;
  readonly records: readonly GoldenRecord[];
};

/** v1 golden (anonymous GET routes), accepted only through `upgradeGolden`. */
export type LegacyGoldenFile = {
  readonly version: typeof LEGACY_CAPTURE_VERSION;
  readonly review: string;
  readonly baseUrl: string;
  readonly clock: string;
  readonly routes: ReadonlyArray<{
    readonly id: string;
    readonly method: "GET";
    readonly path: string;
    readonly requestHeaders: Readonly<Record<string, string>>;
    readonly status: number;
    readonly headers: ReadonlyArray<readonly [string, string]>;
    readonly setCookie: readonly string[];
    readonly body: GoldenBody;
    readonly atomEntryIds?: readonly string[];
  }>;
};

/** Bodies at or below this size are stored verbatim in the golden file; larger ones by hash. */
export const GOLDEN_TEXT_LIMIT = 16 * 1024;

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function upgradeGolden(raw: unknown): GoldenFile {
  const file = raw as { version?: unknown };
  if (file?.version === G1_CAPTURE_VERSION) return raw as GoldenFile;
  if (file?.version === LEGACY_CAPTURE_VERSION) {
    const v1 = raw as LegacyGoldenFile;
    return {
      version: G1_CAPTURE_VERSION,
      review: v1.review,
      baseUrl: v1.baseUrl,
      clock: v1.clock,
      records: v1.routes.map((route) => ({
        kind: "http" as const,
        id: route.id,
        method: route.method,
        path: route.path,
        requestHeaders: route.requestHeaders,
        requestBody: null,
        principal: "anonymous" as const,
        sessionCase: "none" as const,
        session: { case: "none" as const },
        cookieSha256: null,
        status: route.status,
        headers: route.headers,
        setCookie: route.setCookie,
        body: route.body,
        ...(route.atomEntryIds ? { atomEntryIds: route.atomEntryIds } : {}),
      })),
    };
  }
  throw new Error(`Unsupported golden version: ${String(file?.version)}`);
}

function idProblems(label: string, ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) problems.push(`${label}: duplicate record id ${id}`);
    seen.add(id);
  }
  return problems;
}

function orderProblems(
  label: string,
  ids: readonly string[],
  expected: readonly string[],
): string[] {
  if (sameJson(ids, expected)) return [];
  const missing = expected.filter((id) => !ids.includes(id));
  const extra = ids.filter((id) => !expected.includes(id));
  return [
    `${label}: record list/order differs from the program` +
      (missing.length > 0 ? `; missing ${missing.join(",")}` : "") +
      (extra.length > 0 ? `; unexpected ${extra.join(",")}` : ""),
  ];
}

/** Resolve an RFC 6901 JSON pointer; `undefined` when absent. */
export function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  let current = value;
  for (const raw of pointer.slice(1).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object" || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function checkJson(prefix: string, body: unknown, check: JsonCheck): string[] {
  const value = jsonPointer(body, check.pointer);
  const at = `${prefix}: ${check.pointer}`;
  if ("equals" in check) {
    return sameJson(value, check.equals) ? [] : [`${at} is ${JSON.stringify(value)}`];
  }
  if ("length" in check) {
    return Array.isArray(value) && value.length === check.length
      ? []
      : [`${at} length is not ${check.length} (empty or changed collection)`];
  }
  if ("minLength" in check) {
    return Array.isArray(value) && value.length >= check.minLength
      ? []
      : [`${at} has fewer than ${check.minLength} items (empty collection)`];
  }
  if ("present" in check) return value === undefined ? [`${at} is missing`] : [];
  return value === undefined ? [] : [`${at} must be absent`];
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** The request path/headers a scenario must have dispatched, given earlier records. */
export function expectedRequest(
  scenario: HttpScenario,
  earlier: ReadonlyMap<string, CaptureRecord>,
): { path: string; headers: Record<string, string> } | { problem: string } {
  const headers: Record<string, string> = { ...(scenario.headers ?? {}) };
  let path = scenario.path;
  if (scenario.derive) {
    const source = earlier.get(scenario.derive.from);
    if (!source || source.kind !== "http") return { problem: "derivation source missing" };
    const value =
      "header" in scenario.derive.source
        ? source.headers.find(
            ([name]) => name === (scenario.derive!.source as { header: string }).header,
          )?.[1]
        : jsonPointer(parseJson(bodyText(source)), scenario.derive.source.jsonPointer);
    if (typeof value !== "string" || value === "") return { problem: "derived input missing" };
    if ("header" in scenario.derive.into) headers[scenario.derive.into.header] = value;
    else {
      path += `${path.includes("?") ? "&" : "?"}${scenario.derive.into.query}=${encodeURIComponent(value)}`;
    }
  }
  return { path, headers };
}

function validateHttp(
  scenario: HttpScenario,
  record: HttpRecord,
  earlier: ReadonlyMap<string, CaptureRecord>,
  sign: SessionSigner | undefined,
): string[] {
  const prefix = record.id;
  const problems: string[] = [];
  const request = record.request;
  if (request.id !== scenario.id) problems.push(`${prefix}: request id differs`);
  if (request.method !== scenario.method) problems.push(`${prefix}: method differs`);
  const expected = expectedRequest(scenario, earlier);
  if ("problem" in expected) problems.push(`${prefix}: ${expected.problem}`);
  else {
    if (request.path !== expected.path) problems.push(`${prefix}: request path/cursor differs`);
    if (!sameJson(request.headers, expected.headers))
      problems.push(`${prefix}: request headers differ`);
  }
  if (request.body !== requestBodyText(scenario)) problems.push(`${prefix}: request body differs`);
  if (request.principal !== scenario.principal) {
    problems.push(`${prefix}: principal ${request.principal} != ${scenario.principal}`);
  }
  if (!sameJson(request.session, scenario.session))
    problems.push(`${prefix}: session recipe differs`);
  problems.push(
    ...principalSessionProblems(request.principal, request.sessionCase, request.session).map(
      (problem) => `${prefix}: ${problem}`,
    ),
  );
  if ((request.session.case === "none") !== (request.cookieSha256 === null)) {
    problems.push(`${prefix}: cookie presence does not match the session recipe`);
  }
  if (sign) {
    const cookie = cookieHeader(request.session, sign);
    const hash = cookie === undefined ? null : sha256Text(cookie);
    if (hash !== request.cookieSha256) problems.push(`${prefix}: dispatched cookie != recipe`);
  }
  const { status, denial, json, bodyExcludes } = scenario.expect;
  if (record.status !== status)
    problems.push(`${prefix}: status ${record.status} != expected ${status}`);
  if (record.status >= 400 && !denial) {
    problems.push(`${prefix}: undeclared error status ${record.status} is not evidence`);
  }
  const text = bodyText(record);
  if (record.status === 200 && record.bodyLength === 0) problems.push(`${prefix}: empty 200 body`);
  const body = json || denial ? parseJson(text) : undefined;
  if (denial) {
    problems.push(
      ...checkJson(prefix, body, { pointer: "/error/code", equals: denial.code }),
      ...checkJson(prefix, body, { pointer: "/error/message", equals: denial.message }),
    );
  }
  for (const check of json ?? []) problems.push(...checkJson(prefix, body, check));
  for (const excluded of bodyExcludes ?? []) {
    if (text.includes(excluded)) problems.push(`${prefix}: body contains excluded ${excluded}`);
  }
  return problems;
}

function validateText(scenario: Scenario, record: CaptureRecord): string[] {
  const prefix = record.id;
  if (record.kind === "http") return [`${prefix}: kind http != ${scenario.kind}`];
  const problems: string[] = [];
  if (scenario.kind === "metadata-loader") {
    if (record.kind !== "metadata-loader")
      return [`${prefix}: kind ${record.kind} != metadata-loader`];
    if (record.loader !== scenario.loader) problems.push(`${prefix}: loader differs`);
    for (const value of scenario.expect.includes ?? []) {
      if (!record.text.includes(JSON.stringify(value)))
        problems.push(`${prefix}: missing ${value}`);
    }
    for (const value of scenario.expect.excludes ?? []) {
      if (record.text.includes(value)) problems.push(`${prefix}: contains excluded ${value}`);
    }
    if (
      scenario.expect.equals !== undefined &&
      !sameJson(parseJson(record.text), scenario.expect.equals)
    ) {
      problems.push(`${prefix}: metadata output differs from the reviewed value`);
    }
  } else if (scenario.kind === "db-state") {
    if (record.kind !== "db-state") return [`${prefix}: kind ${record.kind} != db-state`];
    if (!sameJson(parseJson(record.text), scenario.expect)) {
      problems.push(`${prefix}: state projection differs from the reviewed expectation`);
    }
  }
  return problems;
}

/**
 * Problems with one capture against the reviewed program (empty when it is exactly the reviewed
 * outcome). `sign` (the production signer) re-derives every dispatched cookie when available.
 */
export function validateCapture(
  raw: unknown,
  program: readonly Scenario[] = SCENARIOS,
  sign?: SessionSigner,
): string[] {
  let capture: CaptureFile;
  try {
    capture = upgradeCapture(raw);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  const problems = [...programProblems(program)];
  const ids = capture.records.map((record) => record.id);
  problems.push(...idProblems("capture", ids));
  const order = orderProblems(
    "capture",
    ids,
    program.map((scenario) => scenario.id),
  );
  if (order.length > 0) return [...problems, ...order];
  if (ids.length === 0) return [...problems, "capture is empty"];
  const earlier = new Map<string, CaptureRecord>();
  program.forEach((scenario, index) => {
    const record = capture.records[index]!;
    if (scenario.kind === "http") {
      if (record.kind !== "http") problems.push(`${record.id}: kind ${record.kind} != http`);
      else problems.push(...validateHttp(scenario, record, earlier, sign));
    } else {
      problems.push(...validateText(scenario, record));
    }
    earlier.set(record.id, record);
  });
  return problems;
}

function compareRecord(prefix: string, left: CaptureRecord, right: CaptureRecord): string[] {
  if (left.kind !== right.kind) return [`${prefix}: kind ${left.kind} != ${right.kind}`];
  if (left.kind !== "http" || right.kind !== "http") {
    const a = left as Exclude<CaptureRecord, HttpRecord>;
    const b = right as Exclude<CaptureRecord, HttpRecord>;
    return a.text === b.text && a.sha256 === b.sha256
      ? []
      : [`${prefix}: ${a.kind} output differs`];
  }
  const differences: string[] = [];
  if (left.request.principal !== right.request.principal) {
    differences.push(
      `${prefix}: principal ${left.request.principal} != ${right.request.principal}`,
    );
  }
  if (!sameJson(left.request, right.request)) differences.push(`${prefix}: request differs`);
  if (left.status !== right.status)
    differences.push(`${prefix}: status ${left.status} != ${right.status}`);
  if (!sameJson(normalizedHeaders(left), normalizedHeaders(right))) {
    differences.push(`${prefix}: headers differ`);
  }
  if (!sameJson(left.setCookie, right.setCookie)) differences.push(`${prefix}: set-cookie differs`);
  if (left.bodySha256 !== right.bodySha256 || left.bodyBase64 !== right.bodyBase64) {
    differences.push(`${prefix}: body bytes differ`);
  }
  return differences;
}

/** Differences between two captures of the same program (empty when byte-identical). */
export function comparePairedCaptures(beforeRaw: unknown, afterRaw: unknown): string[] {
  const before = upgradeCapture(beforeRaw);
  const after = upgradeCapture(afterRaw);
  const differences: string[] = [];
  for (const key of ["baseUrl", "clock"] as const) {
    if (before[key] !== after[key]) differences.push(`capture ${key} differs`);
  }
  const beforeIds = before.records.map((record) => record.id);
  const afterIds = after.records.map((record) => record.id);
  differences.push(...idProblems("before", beforeIds), ...idProblems("after", afterIds));
  if (!sameJson(beforeIds, afterIds)) {
    differences.push(`record list/order differs: ${beforeIds.join(",")} vs ${afterIds.join(",")}`);
    return differences;
  }
  if (beforeIds.length === 0) differences.push("captures are empty");
  before.records.forEach((record, index) => {
    differences.push(...compareRecord(record.id, record, after.records[index]!));
  });
  return differences;
}

/** Differences between a capture and the reviewed golden file (program-checked). */
export function compareWithGolden(
  captureRaw: unknown,
  goldenRaw: unknown,
  program: readonly Scenario[] = SCENARIOS,
): string[] {
  const capture = upgradeCapture(captureRaw);
  const golden = upgradeGolden(goldenRaw);
  const differences: string[] = [];
  if (capture.baseUrl !== golden.baseUrl) differences.push("baseUrl differs from golden");
  if (capture.clock !== golden.clock) differences.push("clock differs from golden");
  const ids = capture.records.map((record) => record.id);
  const goldenIds = golden.records.map((record) => record.id);
  differences.push(...idProblems("capture", ids), ...idProblems("golden", goldenIds));
  const programIds = program.map((scenario) => scenario.id);
  differences.push(...orderProblems("golden", goldenIds, programIds));
  if (!sameJson(ids, goldenIds)) {
    differences.push(`record list/order differs from golden: ${ids.join(",")}`);
    return differences;
  }
  if (ids.length === 0) differences.push("golden and capture are empty");
  const scenarios = new Map(program.map((scenario) => [scenario.id, scenario]));
  capture.records.forEach((record, index) => {
    const entry = golden.records[index]!;
    const prefix = `${entry.id} (golden)`;
    const scenario = scenarios.get(entry.id);
    if (record.kind !== entry.kind) {
      differences.push(`${prefix}: kind ${record.kind} != ${entry.kind}`);
      return;
    }
    if (record.kind !== "http" || entry.kind !== "http") {
      const text = (record as Exclude<CaptureRecord, HttpRecord>).text;
      const goldenText = entry as GoldenTextRecord;
      if ("encoding" in goldenText.body) {
        if (goldenText.body.text !== text)
          differences.push(`${prefix}: ${entry.kind} output differs`);
      } else if (
        sha256Text(text) !== goldenText.body.sha256 ||
        Buffer.byteLength(text, "utf8") !== goldenText.body.length
      ) {
        differences.push(`${prefix}: ${entry.kind} hash/length differs`);
      }
      return;
    }
    const request = record.request;
    if (
      request.method !== entry.method ||
      request.path !== entry.path ||
      !sameJson(request.headers, entry.requestHeaders) ||
      request.body !== entry.requestBody ||
      !sameJson(request.session, entry.session) ||
      request.cookieSha256 !== entry.cookieSha256
    ) {
      differences.push(`${prefix}: request differs`);
    }
    if (request.principal !== entry.principal || request.sessionCase !== entry.sessionCase) {
      differences.push(
        `${prefix}: principal/session ${request.principal}/${request.sessionCase} != ${entry.principal}/${entry.sessionCase}`,
      );
    }
    if (record.status !== entry.status) {
      differences.push(`${prefix}: status ${record.status} != ${entry.status}`);
    }
    const expected = scenario?.kind === "http" ? scenario.expect : undefined;
    if (!expected || entry.status !== expected.status) {
      differences.push(
        `${prefix}: golden status ${entry.status} is not the program's expected outcome`,
      );
    }
    if (entry.status >= 400 && !expected?.denial) {
      differences.push(`${prefix}: golden must not record an undeclared error status`);
    }
    if (entry.status === 200 && record.bodyLength === 0) {
      differences.push(`${prefix}: 200 response has an empty body`);
    }
    if (!sameJson(normalizedHeaders(record), entry.headers)) {
      differences.push(`${prefix}: headers differ`);
    }
    if (!sameJson(record.setCookie, entry.setCookie)) {
      differences.push(`${prefix}: set-cookie differs`);
    }
    if ("encoding" in entry.body) {
      const expectedBytes = Buffer.from(entry.body.text, "utf8");
      if (!expectedBytes.equals(Buffer.from(record.bodyBase64, "base64"))) {
        differences.push(`${prefix}: body bytes differ`);
      }
    } else if (record.bodySha256 !== entry.body.sha256 || record.bodyLength !== entry.body.length) {
      differences.push(`${prefix}: body hash/length differs`);
    }
    if (entry.atomEntryIds !== undefined) {
      const entries = atomEntryIds(bodyText(record));
      if (entry.atomEntryIds.length === 0) differences.push(`${prefix}: feed golden is empty`);
      if (!sameJson(entries, entry.atomEntryIds)) {
        differences.push(`${prefix}: feed entry count/order differs`);
      }
    }
  });
  return differences;
}

function goldenBody(text: string, bytesBase64: string, length: number, sha256: string): GoldenBody {
  const verbatim =
    length <= GOLDEN_TEXT_LIMIT && Buffer.from(text, "utf8").toString("base64") === bytesBase64;
  return verbatim ? { encoding: "utf8", text } : { sha256, length };
}

/**
 * A golden *candidate* derived from a capture, for human review. The harness never writes it over
 * the reviewed golden file and never accepts it automatically after a failure.
 */
export function goldenCandidate(captureRaw: unknown, review: string): GoldenFile {
  const capture = upgradeCapture(captureRaw);
  return {
    version: G1_CAPTURE_VERSION,
    review,
    baseUrl: capture.baseUrl,
    clock: capture.clock,
    records: capture.records.map((record): GoldenRecord => {
      if (record.kind !== "http") {
        return {
          kind: record.kind,
          id: record.id,
          ...(record.kind === "metadata-loader" ? { loader: record.loader } : {}),
          body: goldenBody(
            record.text,
            Buffer.from(record.text, "utf8").toString("base64"),
            record.length,
            record.sha256,
          ),
        };
      }
      const text = bodyText(record);
      const isAtom = normalizedHeaders(record).some(
        ([name, value]) => name === "content-type" && value.startsWith("application/atom+xml"),
      );
      return {
        kind: "http",
        id: record.id,
        method: record.request.method,
        path: record.request.path,
        requestHeaders: record.request.headers,
        requestBody: record.request.body,
        principal: record.request.principal,
        sessionCase: record.request.sessionCase,
        session: record.request.session,
        cookieSha256: record.request.cookieSha256,
        status: record.status,
        headers: normalizedHeaders(record),
        setCookie: record.setCookie,
        body: goldenBody(text, record.bodyBase64, record.bodyLength, record.bodySha256),
        ...(isAtom ? { atomEntryIds: atomEntryIds(text) } : {}),
      };
    }),
  };
}
