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
    const client = new CertifierApiClient(
      "https://atlas.example",
      "secret",
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
    await client.listPublicResults("v1");
    expect(run).toMatchObject({ method: "POST" });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer secret" });
  });
  it("contains no database or internal package dependency", () => {
    const source = readFileSync(resolve(process.cwd(), "scripts/certifier-api-client.ts"), "utf8");
    expect(source).not.toMatch(/@prisma|PrismaClient|@oratlas\/|src\/lib|\.\.\//);
  });
});
