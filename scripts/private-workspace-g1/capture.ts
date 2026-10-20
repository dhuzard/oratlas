import { createHash } from "node:crypto";

/**
 * Raw public-response capture format. Bodies are kept as exact bytes (base64) with their SHA-256;
 * headers are kept as the ordered `[name, value]` list the Fetch `Headers` iterator yields, plus
 * `Set-Cookie` values separately, so duplicates and multi-value semantics are preserved.
 */

export const G1_CAPTURE_VERSION = 1;
/** Deterministic, non-routable origin used for every capture. */
export const G1_BASE_URL = "https://g1.oratlas.example";
/** Fixed wall clock for handlers that print the current time. */
export const G1_FIXED_CLOCK = "2026-04-01T00:00:00.000Z";
/** The only header names a reviewed comparison may normalize. */
export const NORMALIZED_HEADERS: ReadonlySet<string> = new Set(["date", "x-request-id"]);

export type CapturedRequest = {
  readonly id: string;
  readonly method: "GET";
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
};

export type CapturedResponse = {
  readonly id: string;
  readonly request: CapturedRequest;
  readonly status: number;
  readonly headers: ReadonlyArray<readonly [string, string]>;
  readonly setCookie: readonly string[];
  readonly bodyBase64: string;
  readonly bodySha256: string;
  readonly bodyLength: number;
};

export type CaptureFile = {
  readonly version: typeof G1_CAPTURE_VERSION;
  readonly label: string;
  readonly baseUrl: string;
  readonly clock: string;
  readonly principal: "anonymous";
  readonly responses: readonly CapturedResponse[];
};

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function captureResponse(
  request: CapturedRequest,
  response: Response,
): Promise<CapturedResponse> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const headers: Array<[string, string]> = [];
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers.push([name, value]);
  });
  return {
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

export function bodyText(response: CapturedResponse): string {
  return Buffer.from(response.bodyBase64, "base64").toString("utf8");
}

/** Headers with only the reviewed normalization applied (date/request id removed). */
export function normalizedHeaders(
  response: Pick<CapturedResponse, "headers">,
): Array<readonly [string, string]> {
  return response.headers.filter(([name]) => !NORMALIZED_HEADERS.has(name.toLowerCase()));
}

/** Count/order facts for an Atom body: entry ids in document order. */
export function atomEntryIds(xml: string): string[] {
  const ids: string[] = [];
  for (const match of xml.matchAll(/<entry>\s*<id>([^<]*)<\/id>/gu)) ids.push(match[1]!);
  return ids;
}
