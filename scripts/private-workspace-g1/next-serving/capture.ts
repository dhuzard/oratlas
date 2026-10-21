import { performance } from "node:perf_hooks";
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

export async function requestServingResponse(
  port: number,
  path: string,
  cookie: string | undefined,
  deadline: number,
): Promise<Response> {
  if (!Number.isFinite(deadline) || deadline <= performance.now())
    throw new Error("Serving response deadline exceeded");
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
          try {
            const headers = new Headers();
            for (let index = 0; index < res.rawHeaders.length; index += 2)
              headers.append(res.rawHeaders[index]!, res.rawHeaders[index + 1]!);
            done(new Response(Buffer.concat(chunks), { status: res.statusCode!, headers }));
          } catch (error) {
            // Conversion failures must reject through captureNextServing's cleanup path.
            fail(error);
          }
        });
      },
    );
    const timer = setTimeout(
      () => req.destroy(new Error("Serving response deadline exceeded")),
      Math.max(1, deadline - performance.now()),
    );
    req.once("close", () => clearTimeout(timer));
    req.once("error", (error) => {
      clearTimeout(timer);
      fail(error);
    });
    req.end();
  });
}

/** A fresh process for every call; the same prepared build can be reused. */
export async function captureNextServing(
  input: Parameters<typeof startNextServer>[0] & {
    buildId: string;
    sign: SessionSigner;
    captureTimeoutMs?: number;
  },
): Promise<ServingCapture> {
  const budget = input.captureTimeoutMs ?? 40_000;
  if (!Number.isFinite(budget) || budget <= 0 || budget > 40_000)
    throw new Error("Capture timeout must be finite and within (0, 40000] milliseconds");
  const deadline = performance.now() + budget;
  if (readFileSync(resolve(input.root, "apps/web/.next/BUILD_ID"), "utf8").trim() !== input.buildId)
    throw new Error("Prepared build identity mismatch");
  const server = await startNextServer({
    ...input,
    readyTimeoutMs: Math.min(input.readyTimeoutMs ?? 30_000, budget),
  });
  try {
    const records: HttpRecord[] = [];
    for (const path of SERVING_PATHS)
      for (const principal of PRINCIPAL_LABELS) {
        if (performance.now() >= deadline) throw new Error("Serving capture deadline exceeded");
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
          await requestServingResponse(
            input.port,
            path,
            cookie,
            Math.min(deadline, performance.now() + 10_000),
          ),
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
