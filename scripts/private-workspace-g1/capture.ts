import { createHash } from "node:crypto";
import {
  NO_SESSION,
  type PrincipalLabel,
  type SessionCase,
  type SessionRecipe,
} from "./principals.js";

/**
 * Raw capture format (v2). Every record is one scenario of the reviewed ordered program
 * (scenarios.ts): an HTTP route-handler invocation with its principal/session recipe, a metadata
 * loader output (not an HTTP response), or a deterministic database-state projection. HTTP bodies
 * are kept as exact bytes (base64) with their SHA-256; headers are the ordered `[name, value]` list
 * the Fetch `Headers` iterator yields, plus `Set-Cookie` values separately.
 *
 * v1 files (anonymous GET responses only) are upgraded on read; any other version is rejected.
 */

export const G1_CAPTURE_VERSION = 2;
export const LEGACY_CAPTURE_VERSION = 1;
/** Deterministic, non-routable origin used for every capture. */
export const G1_BASE_URL = "https://g1.oratlas.example";
/** Fixed wall clock (Date only) for every handler invocation. */
export const G1_FIXED_CLOCK = "2026-04-01T00:00:00.000Z";
/** Deterministic rate-limit budget: the RateLimit-* headers are captured, never normalized. */
export const G1_RATE_LIMIT = { max: "1000", windowMs: "60000" } as const;
/** The only header names a reviewed comparison may normalize. */
export const NORMALIZED_HEADERS: ReadonlySet<string> = new Set(["date", "x-request-id"]);

export type HttpMethod = "GET" | "POST";

export type CapturedRequest = {
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  /** Request headers except Cookie, lower-case names. */
  readonly headers: Readonly<Record<string, string>>;
  /** Exact request body text, or null. */
  readonly body: string | null;
  readonly principal: PrincipalLabel;
  readonly sessionCase: SessionCase;
  readonly session: SessionRecipe;
  /** SHA-256 of the Cookie header actually dispatched; null when no cookie was sent. */
  readonly cookieSha256: string | null;
};

export type HttpRecord = {
  readonly kind: "http";
  readonly id: string;
  readonly request: CapturedRequest;
  readonly status: number;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly setCookie: readonly string[];
  readonly bodyBase64: string;
  readonly bodySha256: string;
  readonly bodyLength: number;
};

/** Output of a Next metadata loader function, serialized deterministically. Not an HTTP response. */
export type MetadataRecord = {
  readonly kind: "metadata-loader";
  readonly id: string;
  readonly loader: "app/sitemap.ts" | "app/robots.ts";
  readonly text: string;
  readonly sha256: string;
  readonly length: number;
};

/** Deterministic projection of mutable database state at a point in the program. */
export type StateRecord = {
  readonly kind: "db-state";
  readonly id: string;
  readonly text: string;
  readonly sha256: string;
  readonly length: number;
};

export type CaptureRecord = HttpRecord | MetadataRecord | StateRecord;

export type CaptureFile = {
  readonly version: typeof G1_CAPTURE_VERSION;
  readonly label: string;
  readonly baseUrl: string;
  readonly clock: string;
  readonly records: readonly CaptureRecord[];
};

/** v1 shapes, accepted only through `upgradeCapture`. */
export type LegacyCapturedResponse = {
  readonly id: string;
  readonly request: {
    readonly id: string;
    readonly method: "GET";
    readonly path: string;
    readonly headers: Readonly<Record<string, string>>;
  };
  readonly status: number;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly setCookie: readonly string[];
  readonly bodyBase64: string;
  readonly bodySha256: string;
  readonly bodyLength: number;
};

export type LegacyCaptureFile = {
  readonly version: typeof LEGACY_CAPTURE_VERSION;
  readonly label: string;
  readonly baseUrl: string;
  readonly clock: string;
  readonly principal: "anonymous";
  readonly responses: readonly LegacyCapturedResponse[];
};

export class CaptureFormatError extends Error {
  override readonly name = "CaptureFormatError";
}

export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Upgrade a v1 anonymous-GET record; the principal is anonymous with no session. */
export function upgradeLegacyResponse(response: LegacyCapturedResponse): HttpRecord {
  return {
    kind: "http",
    id: response.id,
    request: {
      id: response.request.id,
      method: response.request.method,
      path: response.request.path,
      headers: response.request.headers,
      body: null,
      principal: "anonymous",
      sessionCase: "none",
      session: NO_SESSION,
      cookieSha256: null,
    },
    status: response.status,
    headers: response.headers,
    setCookie: response.setCookie,
    bodyBase64: response.bodyBase64,
    bodySha256: response.bodySha256,
    bodyLength: response.bodyLength,
  };
}

/** Read any supported capture version as v2; unknown versions are rejected. */
export function upgradeCapture(raw: unknown): CaptureFile {
  const file = raw as { version?: unknown };
  if (file?.version === G1_CAPTURE_VERSION) {
    const v2 = raw as CaptureFile;
    if (!Array.isArray(v2.records)) throw new CaptureFormatError("v2 capture has no records");
    return v2;
  }
  if (file?.version === LEGACY_CAPTURE_VERSION) {
    const v1 = raw as LegacyCaptureFile;
    if (!Array.isArray(v1.responses) || v1.principal !== "anonymous") {
      throw new CaptureFormatError("v1 capture must hold anonymous responses");
    }
    return {
      version: G1_CAPTURE_VERSION,
      label: v1.label,
      baseUrl: v1.baseUrl,
      clock: v1.clock,
      records: v1.responses.map(upgradeLegacyResponse),
    };
  }
  throw new CaptureFormatError(`Unsupported capture version: ${String(file?.version)}`);
}

export async function captureHttp(
  request: CapturedRequest,
  response: Response,
): Promise<HttpRecord> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const headers: Array<[string, string]> = [];
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers.push([name, value]);
  });
  return {
    kind: "http",
    id: request.id,
    request,
    status: response.status,
    headers,
    setCookie: response.headers.getSetCookie(),
    bodyBase64: Buffer.from(bytes).toString("base64"),
    bodySha256: sha256Hex(bytes),
    bodyLength: bytes.byteLength,
  };
}

/** JSON with Dates as ISO strings and insertion-ordered keys (deterministic for fixed input). */
export function deterministicJson(value: unknown): string {
  return `${JSON.stringify(
    value,
    function replacer(this: Record<string, unknown>, key: string, item: unknown) {
      const original = this[key];
      if (original instanceof Date) return original.toISOString();
      if (item instanceof Map || item instanceof Set || typeof item === "bigint") {
        throw new CaptureFormatError(`Non-JSON value at ${key || "<root>"}`);
      }
      return item;
    },
    2,
  )}\n`;
}

export function textRecord<K extends "metadata-loader" | "db-state">(
  kind: K,
  id: string,
  text: string,
): { kind: K; id: string; text: string; sha256: string; length: number } {
  return { kind, id, text, sha256: sha256Hex(text), length: Buffer.byteLength(text, "utf8") };
}

export function bodyText(record: Pick<HttpRecord, "bodyBase64">): string {
  return Buffer.from(record.bodyBase64, "base64").toString("utf8");
}

/** Headers with only the reviewed normalization applied (date/request id removed). */
export function normalizedHeaders(
  record: Pick<HttpRecord, "headers">,
): Array<readonly [string, string]> {
  return record.headers.filter(([name]) => !NORMALIZED_HEADERS.has(name.toLowerCase()));
}

/** Count/order facts for an Atom body: entry ids in document order. */
export function atomEntryIds(xml: string): string[] {
  const ids: string[] = [];
  for (const match of xml.matchAll(/<entry>\s*<id>([^<]*)<\/id>/gu)) ids.push(match[1]!);
  return ids;
}

export function httpRecords(capture: CaptureFile): HttpRecord[] {
  return capture.records.filter((record): record is HttpRecord => record.kind === "http");
}
