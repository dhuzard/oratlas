import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { CertifierApiClient } from "./certifier-api-client";

describe("external certifier acceptance client", () => {
  it("completes the journey using HTTP and a scoped bearer credential only", async () => {
    const fetcher = vi.fn(
      async (url: URL | RequestInfo, init?: RequestInit) =>
        new Response(JSON.stringify({ url: String(url), method: init?.method ?? "GET" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const credential = "acceptance-test-credential";
    const client = new CertifierApiClient(
      "https://atlas.example",
      credential,
      fetcher as typeof fetch,
    );
    const run = await client.createRun({
      publicationVersionId: "v1",
      certificationProtocolId: "p1",
      assessmentMode: "human",
      idempotencyKey: "external-001",
    });
    await client.getInput("run-1");
    await client.submitResult("run-1", { outcome: "inconclusive" });
    await client.transitionRun("run-2", { status: "failed", reason: "Evaluator unavailable." });
    await client.listPublicResults("v1");
    expect(run).toMatchObject({ method: "POST" });
    expect(fetcher).toHaveBeenCalledTimes(5);
    const headers = new Headers(fetcher.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe(`Bearer ${credential}`);
    expect(headers.get("content-type")).toBe("application/json");
  });
  it("contains no database or internal package dependency", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/certifier-client/src/index.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/@prisma|PrismaClient|@oratlas\/|src\/lib|\.\.\//);
  });
});
