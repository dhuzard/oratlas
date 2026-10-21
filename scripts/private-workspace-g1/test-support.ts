import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { G1_CAPTURE_VERSION, sha256Hex, type CaptureFile, type CaptureRecord } from "./capture.js";
import { upgradeGolden, type GoldenFile } from "./compare.js";

/** Offline-test helpers: the reviewed golden, and a synthetic capture equal to it. */

export const GOLDEN_PATH = resolve(
  process.cwd(),
  "scripts/private-workspace-g1/baselines/public-routes.golden.json",
);

export function readGolden(): GoldenFile {
  return upgradeGolden(JSON.parse(readFileSync(GOLDEN_PATH, "utf8")));
}

/**
 * A capture equal to the golden. Hash-only golden bodies are not reconstructible, so such records
 * carry only the recorded hash/length (the comparators check exactly those).
 */
export function captureFromGolden(label: string, golden: GoldenFile = readGolden()): CaptureFile {
  return {
    version: G1_CAPTURE_VERSION,
    label,
    baseUrl: golden.baseUrl,
    clock: golden.clock,
    records: golden.records.map((entry): CaptureRecord => {
      const text = "encoding" in entry.body ? entry.body.text : undefined;
      if (entry.kind !== "http") {
        if (text === undefined) throw new Error(`${entry.id}: text record stored by hash`);
        const base = {
          id: entry.id,
          text,
          sha256: sha256Hex(text),
          length: Buffer.byteLength(text),
        };
        return entry.kind === "metadata-loader"
          ? { kind: "metadata-loader", loader: entry.loader as "app/sitemap.ts", ...base }
          : { kind: "db-state", ...base };
      }
      const bytes = text === undefined ? undefined : Buffer.from(text, "utf8");
      return {
        kind: "http",
        id: entry.id,
        request: {
          id: entry.id,
          method: entry.method,
          path: entry.path,
          headers: entry.requestHeaders,
          body: entry.requestBody,
          principal: entry.principal,
          sessionCase: entry.sessionCase,
          session: entry.session,
          cookieSha256: entry.cookieSha256,
        },
        status: entry.status,
        headers: entry.headers,
        setCookie: entry.setCookie,
        bodyBase64: bytes ? bytes.toString("base64") : "",
        bodySha256: bytes ? sha256Hex(bytes) : "sha256" in entry.body ? entry.body.sha256 : "",
        bodyLength: bytes ? bytes.byteLength : "length" in entry.body ? entry.body.length : 0,
      };
    }),
  };
}

/** Deep-copy a capture and replace one record through `patch`. */
export function withRecord(
  capture: CaptureFile,
  id: string,
  patch: (record: CaptureRecord) => CaptureRecord,
): CaptureFile {
  const copy = JSON.parse(JSON.stringify(capture)) as CaptureFile;
  return {
    ...copy,
    records: copy.records.map((record) => (record.id === id ? patch(record) : record)),
  };
}

type JsonBody = Record<string, unknown> & {
  readonly events: unknown[];
  readonly notifications: unknown[];
};

/** Replace an HTTP record's JSON body. */
export function withJsonBody(capture: CaptureFile, id: string, edit: (body: JsonBody) => unknown) {
  return withRecord(capture, id, (record) => {
    if (record.kind !== "http") throw new Error(`${id} is not http`);
    const body = edit(
      JSON.parse(Buffer.from(record.bodyBase64, "base64").toString("utf8")) as JsonBody,
    );
    const bytes = Buffer.from(JSON.stringify(body), "utf8");
    return {
      ...record,
      bodyBase64: bytes.toString("base64"),
      bodySha256: sha256Hex(bytes),
      bodyLength: bytes.byteLength,
    };
  });
}
