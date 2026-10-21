import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { request as httpRequest } from "node:http";
import {
  captureHttp,
  G1_BASE_URL,
  G1_FIXED_CLOCK,
  NORMALIZED_HEADERS,
  type HttpRecord,
} from "../capture.js";
import {
  cookieHeader,
  NO_SESSION,
  PRINCIPAL_LABELS,
  sha256Text,
  validSession,
  type SessionSigner,
} from "../principals.js";
import { startNextServer } from "./process.js";

/** First bounded real-serving program; page bodies are never normalized. */
export const SERVING_PATHS = ["/robots.txt", "/sitemap.xml", "/llms.txt", "/", "/connect"] as const;
export interface ServingCapture {
  readonly protocol: "oratlas.g1.next-http/0.1";
  readonly clock: typeof G1_FIXED_CLOCK;
  readonly buildId: string;
  readonly records: readonly HttpRecord[];
}

async function response(port: number, path: string, cookie: string | undefined): Promise<Response> {
  return new Promise((done, fail) => {
    const req = httpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: {
          host: new URL(G1_BASE_URL).host,
          "accept-encoding": "identity",
          ...(cookie ? { cookie } : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let length = 0;
        res.on("data", (chunk: Buffer) => {
          length += chunk.length;
          if (length > 2 * 1024 * 1024) {
            res.destroy(new Error("Serving response exceeds bound"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("error", fail);
        res.on("end", () => {
          const headers = new Headers();
          for (let index = 0; index < res.rawHeaders.length; index += 2)
            headers.append(res.rawHeaders[index]!, res.rawHeaders[index + 1]!);
          done(new Response(Buffer.concat(chunks), { status: res.statusCode!, headers }));
        });
      },
    );
    req.once("error", fail);
    req.setTimeout(30_000, () => req.destroy(new Error("Serving response deadline exceeded")));
    req.end();
  });
}

/** A fresh process for every call; the same prepared build can be reused. */
export async function captureNextServing(
  input: Parameters<typeof startNextServer>[0] & { buildId: string; sign: SessionSigner },
): Promise<ServingCapture> {
  if (readFileSync(resolve(input.root, "apps/web/.next/BUILD_ID"), "utf8").trim() !== input.buildId)
    throw new Error("Prepared build identity mismatch");
  const server = await startNextServer(input);
  try {
    const records: HttpRecord[] = [];
    for (const path of SERVING_PATHS)
      for (const principal of PRINCIPAL_LABELS) {
        const recipe = principal === "anonymous" ? NO_SESSION : validSession(principal);
        const cookie = cookieHeader(recipe, input.sign);
        const id = `next-${path === "/" ? "home" : path.slice(1).replaceAll("/", "-")}-${principal}`;
        const record = await captureHttp(
          {
            id,
            method: "GET",
            path,
            headers: { host: new URL(G1_BASE_URL).host, "accept-encoding": "identity" },
            body: null,
            principal,
            sessionCase: recipe.case,
            session: recipe,
            cookieSha256: cookie ? sha256Text(cookie) : null,
          },
          await response(input.port, path, cookie),
        );
        if (record.status !== 200 || record.bodyLength === 0)
          throw new Error(`Real Next serving failed at ${id}`);
        records.push(record);
      }
    return {
      protocol: "oratlas.g1.next-http/0.1",
      clock: G1_FIXED_CLOCK,
      buildId: input.buildId,
      records,
    };
  } finally {
    await server.stop();
  }
}

/** Exact body/cookie/header equality; only the existing Date/request-id header allowlist applies. */
export function servingDifferences(first: ServingCapture, second: ServingCapture): string[] {
  const differences: string[] = [];
  if (
    first.buildId !== second.buildId ||
    first.protocol !== second.protocol ||
    first.clock !== second.clock
  )
    differences.push("capture identity");
  if (first.records.length !== second.records.length) differences.push("record count");
  first.records.forEach((record, index) => {
    const other = second.records[index];
    if (!other) return;
    if (record.id !== other.id || JSON.stringify(record.request) !== JSON.stringify(other.request))
      differences.push(`${record.id}: request`);
    if (
      record.status !== other.status ||
      record.bodyBase64 !== other.bodyBase64 ||
      record.bodySha256 !== other.bodySha256 ||
      record.bodyLength !== other.bodyLength
    )
      differences.push(`${record.id}: body/status`);
    const headers = (value: HttpRecord) =>
      value.headers.filter(([key]) => !NORMALIZED_HEADERS.has(key));
    if (
      JSON.stringify(headers(record)) !== JSON.stringify(headers(other)) ||
      JSON.stringify(record.setCookie) !== JSON.stringify(other.setCookie)
    )
      differences.push(`${record.id}: headers/cookies`);
  });
  return differences;
}
