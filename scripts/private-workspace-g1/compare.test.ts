import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionToken } from "../../apps/web/src/lib/session-token";
import {
  atomEntryIds,
  bodyText,
  G1_BASE_URL,
  LEGACY_CAPTURE_VERSION,
  sha256Hex,
  upgradeCapture,
  type CaptureFile,
  type HttpRecord,
  type LegacyCaptureFile,
} from "./capture.js";
import {
  comparePairedCaptures,
  compareWithGolden,
  GOLDEN_TEXT_LIMIT,
  goldenCandidate,
  jsonPointer,
  upgradeGolden,
  validateCapture,
} from "./compare.js";
import { validSession } from "./principals.js";
import { CAPTURE_BYTES_SENTINEL, programProblems, SCENARIOS, type Scenario } from "./scenarios.js";
import { captureFromGolden, readGolden, withJsonBody, withRecord } from "./test-support.js";

// Offline: synthetic captures derived from the reviewed golden, the reviewed program and the
// production session signer (pure HMAC). No database, no child process.
const golden = readGolden();
const capture = captureFromGolden("baseline", golden);
const http = (file: CaptureFile, id: string) =>
  file.records.find((record) => record.id === id) as HttpRecord;

describe("the reviewed program and golden agree", () => {
  it("has a valid program: unique ids/composite keys and coherent denials", () => {
    expect(programProblems(SCENARIOS)).toEqual([]);
    expect(SCENARIOS.length).toBe(93);
  });

  it("validates the golden-derived capture, re-deriving every cookie with the production signer", () => {
    expect(validateCapture(capture, SCENARIOS, createSessionToken)).toEqual([]);
    expect(comparePairedCaptures(capture, captureFromGolden("after", golden))).toEqual([]);
    expect(compareWithGolden(capture, golden)).toEqual([]);
  });

  it("records only declared denials, non-empty successes and the expected outcome mix", () => {
    const statuses: Record<string, number> = {};
    for (const entry of golden.records) {
      const key = entry.kind === "http" ? String(entry.status) : entry.kind;
      statuses[key] = (statuses[key] ?? 0) + 1;
      if (entry.kind === "http" && entry.status === 200) {
        expect("text" in entry.body ? entry.body.text.length : entry.body.length).toBeGreaterThan(
          0,
        );
      }
    }
    expect(statuses).toEqual({
      "200": 45,
      "304": 2,
      "401": 8,
      "403": 8,
      "404": 25,
      "db-state": 3,
      "metadata-loader": 2,
    });
    const feed = golden.records.find((entry) => entry.id === "feeds-atom");
    expect(feed?.kind === "http" && feed.atomEntryIds).toEqual([
      `${G1_BASE_URL}/reviews/g1-second-review/versions/g1-version-4`,
      `${G1_BASE_URL}/reviews/g1-fixture-review/versions/g1-version-2`,
      `${G1_BASE_URL}/reviews/g1-fixture-review/versions/g1-version-1`,
    ]);
  });

  it("matches the checked-in OpenAPI artifacts and keeps the existing public caching", () => {
    const yaml = readFileSync(resolve(process.cwd(), "docs/openapi.yaml"));
    const entry = (id: string) => {
      const found = golden.records.find((record) => record.id === id);
      if (found?.kind !== "http") throw new Error(id);
      return found;
    };
    expect(entry("openapi-yaml").body).toEqual({
      sha256: createHash("sha256").update(yaml).digest("hex"),
      length: yaml.byteLength,
    });
    const artifacts = readFileSync(
      resolve(process.cwd(), "apps/web/src/generated/openapi-artifacts.ts"),
      "utf8",
    );
    for (const id of ["openapi-yaml", "openapi-json"]) {
      const headers = Object.fromEntries(entry(id).headers);
      expect(headers["cache-control"]).toBe("public, max-age=300, s-maxage=3600");
      expect(artifacts).toContain(JSON.stringify(headers.etag));
      expect(Object.fromEntries(entry(`${id}-304`).headers).etag).toBe(headers.etag);
      expect(entry(`${id}-304`).requestHeaders).toEqual({ "if-none-match": headers.etag });
      expect(entry(`${id}-304`).status).toBe(304);
    }
  });
});

describe("public artifact capture integrity", () => {
  it("binds exact source bytes/digest metadata without copying retained bytes into packets", () => {
    const packet = JSON.parse(bodyText(http(capture, "packet-anonymous"))) as Record<
      string,
      unknown
    >;
    const { sha256, ...unsigned } = packet;
    expect(sha256).toBe(sha256Hex(canonicalJson(unsigned)));
    const metadata = JSON.parse(bodyText(http(capture, "capture-anonymous"))) as Record<
      string,
      unknown
    >;
    expect(metadata.contentSha256).toBe(sha256Hex(CAPTURE_BYTES_SENTINEL));
    expect(metadata.byteLength).toBe(Buffer.byteLength(CAPTURE_BYTES_SENTINEL));
    for (const id of ["capture-anonymous", "packet-anonymous"]) {
      expect(bodyText(http(capture, id))).not.toContain(CAPTURE_BYTES_SENTINEL);
      expect(bodyText(http(capture, id))).not.toContain(
        Buffer.from(CAPTURE_BYTES_SENTINEL).toString("base64"),
      );
    }
  });
});

describe("capture validation regressions", () => {
  it("requires reviewed export text markers even when a replacement golden would accept new bytes", () => {
    const program = SCENARIOS.map((scenario) =>
      scenario.id === "file-public-anonymous" && scenario.kind === "http"
        ? {
            ...scenario,
            expect: {
              ...scenario.expect,
              bodyEquals: undefined,
              bodyIncludes: ["G1 inert public attachment"],
            },
          }
        : scenario,
    );
    expect(validateCapture(capture, program)).toEqual([]);
    const mutated = withRecord(capture, "file-public-anonymous", (record) => {
      if (record.kind !== "http") throw new Error("http required");
      const body = "unrelated public text\n";
      return {
        ...record,
        bodyBase64: Buffer.from(body).toString("base64"),
        bodySha256: sha256Hex(body),
        bodyLength: Buffer.byteLength(body),
      };
    });
    expect(validateCapture(mutated, program)).toContain(
      "file-public-anonymous: body missing required G1 inert public attachment",
    );
  });
  it("rejects retained bytes, public principal divergence and stripped attachment headers", () => {
    const leaked = withJsonBody(capture, "capture-anonymous", (body) => ({
      ...body,
      contentBytes: "G1 retained capture bytes: <script>inert</script>",
    }));
    expect(validateCapture(leaked, SCENARIOS)).toContain(
      "capture-anonymous: body contains excluded G1 retained capture bytes: <script>inert</script>",
    );
    const divergent = withJsonBody(capture, "capture-a-only", (body) => ({
      ...body,
      unexpectedPrincipalMetadata: "A-only",
    }));
    expect(validateCapture(divergent, SCENARIOS)).toContain(
      "capture-a-only: response differs from capture-anonymous",
    );
    const stripped = withRecord(capture, "file-public-a-only", (record) => {
      if (record.kind !== "http") throw new Error("http required");
      return {
        ...record,
        headers: record.headers.filter(([name]) => name !== "x-content-type-options"),
      };
    });
    expect(validateCapture(stripped, SCENARIOS)).toContain(
      "file-public-a-only: expected header x-content-type-options differs",
    );
    const wrongBytes = withRecord(capture, "file-public-anonymous", (record) => {
      if (record.kind !== "http") throw new Error("http required");
      const body = Buffer.from("changed download");
      return {
        ...record,
        bodyBase64: body.toString("base64"),
        bodySha256: sha256Hex(body),
        bodyLength: body.byteLength,
      };
    });
    expect(validateCapture(wrongBytes, SCENARIOS)).toContain(
      "file-public-anonymous: exact body differs",
    );
  });

  const problems = (file: unknown) => validateCapture(file, SCENARIOS, createSessionToken);

  it("rejects a principal swap, a dropped identity and a cookie that is not the recipe", () => {
    const swapped = withRecord(capture, "certifier-suspend-admin", (record) => {
      const r = record as HttpRecord;
      return { ...r, request: { ...r.request, session: validSession("A-only") } };
    });
    expect(problems(swapped)).toEqual(
      expect.arrayContaining([
        "certifier-suspend-admin: session recipe differs",
        "certifier-suspend-admin: ADMIN principal dispatched the session of g1-user-a-only",
        "certifier-suspend-admin: dispatched cookie != recipe",
      ]),
    );
    const relabelled = withRecord(capture, "notifications-a-only", (record) => {
      const r = record as HttpRecord;
      return { ...r, request: { ...r.request, principal: "B-only" } };
    });
    expect(problems(relabelled)).toContain("notifications-a-only: principal B-only != A-only");
    const dropped = withRecord(capture, "notifications-editor", (record) => {
      const r = record as HttpRecord;
      return { ...r, request: { ...r.request, cookieSha256: null } };
    });
    expect(problems(dropped)).toEqual(
      expect.arrayContaining([
        "notifications-editor: cookie presence does not match the session recipe",
        "notifications-editor: dispatched cookie != recipe",
      ]),
    );
    const forged = withRecord(capture, "notifications-admin", (record) => {
      const r = record as HttpRecord;
      return { ...r, request: { ...r.request, cookieSha256: sha256Hex("oratlas_session=forged") } };
    });
    expect(problems(forged)).toEqual(["notifications-admin: dispatched cookie != recipe"]);
  });

  it("rejects missing, duplicate, extra and reordered records", () => {
    const missing = { ...capture, records: capture.records.filter((r) => r.id !== "claims") };
    expect(problems(missing)[0]).toMatch(/record list\/order differs.*missing claims/u);
    const duplicate = { ...capture, records: [...capture.records, capture.records[0]!] };
    expect(problems(duplicate)).toEqual(
      expect.arrayContaining(["capture: duplicate record id health-ready"]),
    );
    const reordered = {
      ...capture,
      records: [capture.records[1]!, capture.records[0]!, ...capture.records.slice(2)],
    };
    expect(problems(reordered)).toHaveLength(1);
    expect(problems({ ...capture, records: [] })[0]).toMatch(/missing/u);
    const duplicatedProgram: Scenario[] = [...SCENARIOS, SCENARIOS[0]!];
    expect(programProblems(duplicatedProgram)).toEqual(
      expect.arrayContaining(["duplicate scenario id health-ready"]),
    );
  });

  it("upgrades v1 captures/goldens to anonymous records and rejects unknown versions", () => {
    const legacyRecord = http(capture, "health");
    const legacy: LegacyCaptureFile = {
      version: LEGACY_CAPTURE_VERSION,
      label: "baseline",
      baseUrl: capture.baseUrl,
      clock: capture.clock,
      principal: "anonymous",
      responses: [
        {
          id: legacyRecord.id,
          request: { id: "health", method: "GET", path: "/api/health", headers: {} },
          status: legacyRecord.status,
          headers: legacyRecord.headers,
          setCookie: legacyRecord.setCookie,
          bodyBase64: legacyRecord.bodyBase64,
          bodySha256: legacyRecord.bodySha256,
          bodyLength: legacyRecord.bodyLength,
        },
      ],
    };
    const upgraded = upgradeCapture(legacy);
    expect(upgraded.records[0]).toEqual(legacyRecord);
    expect(http(upgraded, "health").request).toMatchObject({
      principal: "anonymous",
      sessionCase: "none",
      cookieSha256: null,
      body: null,
    });
    expect(validateCapture({ ...capture, version: 3 })).toEqual(["Unsupported capture version: 3"]);
    expect(() => comparePairedCaptures({ ...capture, version: 0 }, capture)).toThrow(
      /Unsupported capture version/u,
    );
    expect(() => upgradeGolden({ ...golden, version: 9 })).toThrow(/Unsupported golden version/u);
    // A v1 golden is read as anonymous GET records (and then fails the v2 program's record list).
    const legacyGolden = upgradeGolden({
      version: 1,
      review: "v1",
      baseUrl: golden.baseUrl,
      clock: golden.clock,
      routes: [{ ...golden.records[1], kind: undefined }],
    });
    expect(legacyGolden.records[0]).toMatchObject({ kind: "http", principal: "anonymous" });
  });

  it("refuses undeclared error statuses and wrong denial bodies; declared denials pass only exactly", () => {
    const failed = withRecord(capture, "claims", (record) => ({
      ...(record as HttpRecord),
      status: 500,
    }));
    expect(problems(failed)).toEqual(
      expect.arrayContaining([
        "claims: status 500 != expected 200",
        "claims: undeclared error status 500 is not evidence",
      ]),
    );
    const wrongDenial = withJsonBody(capture, "ora-readiness-a-only", () => ({
      error: { code: "forbidden", message: "Cross-site mutation requests are refused." },
    }));
    expect(problems(wrongDenial)).toEqual([
      'ora-readiness-a-only: /error/message is "Cross-site mutation requests are refused."',
    ]);
    const leaked = withRecord(capture, "certifier-suspend-editor", (record) => ({
      ...(record as HttpRecord),
      status: 200,
    }));
    expect(problems(leaked)).toContain("certifier-suspend-editor: status 200 != expected 403");
    // The golden cannot authorize an error the program does not declare.
    const goldenWithError = {
      ...golden,
      records: golden.records.map((entry) =>
        entry.id === "claims" && entry.kind === "http" ? { ...entry, status: 500 } : entry,
      ),
    };
    expect(compareWithGolden(failed, goldenWithError)).toEqual(
      expect.arrayContaining([
        "claims (golden): golden status 500 is not the program's expected outcome",
        "claims (golden): golden must not record an undeclared error status",
      ]),
    );
  });

  it("refuses empty collections, changed order, a wrong cursor and leaked controls", () => {
    const empty = withJsonBody(capture, "claims", (body) => ({ ...body, total: 0, items: [] }));
    expect(problems(empty)).toEqual([
      "claims: /total is 0",
      "claims: /items length is not 2 (empty or changed collection)",
    ]);
    const reordered = withJsonBody(capture, "feeds-lifecycle", (body) => ({
      ...body,
      events: [...body.events].reverse(),
    }));
    expect(problems(reordered)).toEqual(
      expect.arrayContaining(['feeds-lifecycle: /events/0/id is "g1-lifecycle-1"']),
    );
    const wrongCursor = withRecord(capture, "graph-source-assertions-page-2", (record) => {
      const r = record as HttpRecord;
      return {
        ...r,
        request: { ...r.request, path: r.request.path.replace(/cursor=.*/u, "cursor=x") },
      };
    });
    expect(problems(wrongCursor)).toEqual([
      "graph-source-assertions-page-2: request path/cursor differs",
    ]);
    const noCursor = withJsonBody(capture, "graph-source-assertions-page-1", (body) => ({
      ...body,
      page: { limit: 1 },
    }));
    expect(problems(noCursor)).toEqual(
      expect.arrayContaining([
        "graph-source-assertions-page-1: /page/nextCursor is missing",
        "graph-source-assertions-page-2: derived input missing",
      ]),
    );
    const leaked = withJsonBody(capture, "notifications-b-only", (body) => ({
      notifications: [...body.notifications, { id: "g1-notification-a-only-1" }],
    }));
    expect(problems(leaked)).toEqual(
      expect.arrayContaining([
        "notifications-b-only: body contains excluded g1-notification-a-only-1",
      ]),
    );
    const etag = withRecord(capture, "openapi-json-304", (record) => {
      const r = record as HttpRecord;
      return { ...r, request: { ...r.request, headers: { "if-none-match": '"stale"' } } };
    });
    expect(problems(etag)).toEqual(["openapi-json-304: request headers differ"]);
  });

  it("checks metadata-loader outputs and state projections against the reviewed values", () => {
    const sitemap = withRecord(capture, "metadata-sitemap", (record) => {
      const text = (record as { text: string }).text.replace(
        `"${G1_BASE_URL}/reviews/g1-second-review"`,
        `"${G1_BASE_URL}/reviews/g1-control-review"`,
      );
      return { ...record, text, sha256: sha256Hex(text), length: Buffer.byteLength(text) };
    });
    expect(problems(sitemap)).toEqual([
      `metadata-sitemap: missing ${G1_BASE_URL}/reviews/g1-second-review`,
      "metadata-sitemap: contains excluded g1-control-review",
    ]);
    const robots = withRecord(capture, "metadata-robots", (record) => {
      const text = (record as { text: string }).text.replace('"allow": "/"', '"allow": "/x"');
      return { ...record, text, sha256: sha256Hex(text), length: Buffer.byteLength(text) };
    });
    expect(problems(robots)).toEqual([
      "metadata-robots: metadata output differs from the reviewed value",
    ]);
    const state = withRecord(capture, "state-final", (record) => {
      const value = JSON.parse((record as { text: string }).text);
      value.audit.events[0].actorId = "g1-user-editor";
      const text = JSON.stringify(value);
      return { ...record, text, sha256: sha256Hex(text), length: Buffer.byteLength(text) };
    });
    expect(problems(state)).toEqual([
      "state-final: state projection differs from the reviewed expectation",
    ]);
    const asHttp = withRecord(capture, "metadata-robots", () => ({
      ...http(capture, "health"),
      id: "metadata-robots",
    }));
    expect(problems(asHttp)).toEqual(["metadata-robots: kind http != metadata-loader"]);
  });
});

describe("paired and golden comparison regressions", () => {
  it("flags body, status, header, multi-value header, set-cookie and principal differences", () => {
    const changed = (patch: Partial<HttpRecord>) =>
      comparePairedCaptures(
        capture,
        withRecord(capture, "llms-txt", (record) => ({ ...(record as HttpRecord), ...patch })),
      );
    const record = http(capture, "llms-txt");
    expect(changed({ bodyBase64: Buffer.from("x").toString("base64") })).toEqual([
      "llms-txt: body bytes differ",
    ]);
    expect(changed({ status: 304 })).toEqual(["llms-txt: status 200 != 304"]);
    expect(changed({ headers: [...record.headers, ["x-cache", "HIT"]] })).toEqual([
      "llms-txt: headers differ",
    ]);
    expect(changed({ setCookie: ["s=1"] })).toEqual(["llms-txt: set-cookie differs"]);
    const links = http(capture, "graph-source-assertions-page-1").headers;
    const swappedLinks = withRecord(capture, "graph-source-assertions-page-1", (r) => ({
      ...(r as HttpRecord),
      headers: links.map(([name, value]) =>
        name === "link" ? [name, value.split(", ").reverse().join(", ")] : [name, value],
      ),
    }));
    expect(comparePairedCaptures(capture, swappedLinks)).toEqual([
      "graph-source-assertions-page-1: headers differ",
    ]);
    const principal = withRecord(capture, "notifications-a-only", (r) => ({
      ...(r as HttpRecord),
      request: { ...(r as HttpRecord).request, principal: "B-only" },
    }));
    expect(comparePairedCaptures(capture, principal)).toEqual([
      "notifications-a-only: principal A-only != B-only",
      "notifications-a-only: request differs",
    ]);
    const remaining = http(capture, "graph-source-assertions-page-2").headers.map(
      ([name, value]): [string, string] => [name, name === "ratelimit-remaining" ? "997" : value],
    );
    expect(
      comparePairedCaptures(
        capture,
        withRecord(capture, "graph-source-assertions-page-2", (r) => ({
          ...(r as HttpRecord),
          headers: remaining,
        })),
      ),
    ).toEqual(["graph-source-assertions-page-2: headers differ"]);
  });

  it("normalizes only date and request-id headers", () => {
    const after = withRecord(capture, "llms-txt", (r) => ({
      ...(r as HttpRecord),
      headers: [...(r as HttpRecord).headers, ["date", "now"], ["x-request-id", "r1"]],
    }));
    expect(comparePairedCaptures(capture, after)).toEqual([]);
  });

  it("flags missing, extra, duplicate or reordered records and empty captures", () => {
    const shorter = { ...capture, records: capture.records.slice(1) };
    expect(comparePairedCaptures(capture, shorter)).toHaveLength(1);
    const duplicate = {
      ...capture,
      records: [...capture.records.slice(0, -1), capture.records[0]!],
    };
    expect(comparePairedCaptures(capture, duplicate)).toEqual(
      expect.arrayContaining(["after: duplicate record id health-ready"]),
    );
    expect(comparePairedCaptures({ ...capture, records: [] }, { ...capture, records: [] })).toEqual(
      ["captures are empty"],
    );
    expect(compareWithGolden(shorter, golden)[0]).toMatch(
      /record list\/order differs from golden/u,
    );
  });

  it("detects state, metadata and body drift against the golden, and builds reviewable candidates", () => {
    const state = withRecord(capture, "state-after-orcid-a-only", (record) => {
      const text = (record as { text: string }).text.replace('"count": 1', '"count": 2');
      return { ...record, text, sha256: sha256Hex(text), length: Buffer.byteLength(text) };
    });
    expect(compareWithGolden(state, golden)).toEqual([
      "state-after-orcid-a-only (golden): db-state output differs",
    ]);
    const feed = withRecord(capture, "feeds-atom", (record) => {
      const r = record as HttpRecord;
      const text = bodyText(r).replace("g1-version-4", "g1-version-X");
      const bytes = Buffer.from(text);
      return {
        ...r,
        bodyBase64: bytes.toString("base64"),
        bodySha256: sha256Hex(bytes),
        bodyLength: bytes.byteLength,
      };
    });
    expect(compareWithGolden(feed, golden)).toEqual([
      "feeds-atom (golden): body bytes differ",
      "feeds-atom (golden): feed entry count/order differs",
    ]);
    const candidate = goldenCandidate(capture, "test");
    expect(candidate.records.map((record) => record.id)).toEqual(SCENARIOS.map((s) => s.id));
    expect(compareWithGolden(capture, candidate)).toEqual([]);
    const large = "x".repeat(GOLDEN_TEXT_LIMIT + 1);
    const withLarge = withRecord(capture, "metadata-sitemap", (record) => ({
      ...record,
      text: large,
      sha256: sha256Hex(large),
      length: large.length,
    }));
    const largeCandidate = goldenCandidate(withLarge, "test");
    expect(largeCandidate.records.find((r) => r.id === "metadata-sitemap")?.body).toEqual({
      sha256: sha256Hex(large),
      length: large.length,
    });
    expect(atomEntryIds(bodyText(http(capture, "feeds-atom")))).toHaveLength(3);
    expect(jsonPointer({ a: [{ "b/c": 1 }] }, "/a/0/b~1c")).toBe(1);
    expect(jsonPointer({ a: 1 }, "/missing")).toBeUndefined();
  });
});
