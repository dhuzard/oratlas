import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  captureResponse,
  G1_BASE_URL,
  G1_CAPTURE_VERSION,
  G1_FIXED_CLOCK,
  type CaptureFile,
  type CapturedRequest,
  type CapturedResponse,
} from "./capture.js";
import { comparePairedCaptures } from "./compare.js";
import { G1_ENV, parseConnectionUrl, PUBLIC_ROLE_NAME } from "./target.js";

// T-PUB G1-empty capture. Runs only in a child process that the orchestrator gives the PUBLIC
// runtime URL as DATABASE_URL and nothing else. Real production handlers and the real Prisma client
// are used; only `server-only` is stubbed, the clock is fixed for /api/health and outbound HTTP is
// blocked. Missing or wrong configuration fails the suite; it never skips. (`server-only` is
// aliased to an empty stub by the dedicated vitest.config.ts.)

const FORBIDDEN_ENV = [G1_ENV.admin, G1_ENV.private, G1_ENV.public, G1_ENV.ack, "PGPASSWORD"];

function captureConfig(): { out: string; label: string } {
  const present = FORBIDDEN_ENV.filter((name) => process.env[name] !== undefined);
  if (present.length > 0) {
    throw new Error(`Capture process must not receive: ${present.join(", ")}`);
  }
  const database = parseConnectionUrl("DATABASE_URL", process.env.DATABASE_URL);
  if (!PUBLIC_ROLE_NAME.test(database.user)) {
    throw new Error("DATABASE_URL must authenticate as the restricted public runtime role");
  }
  if (process.env.NEXT_PUBLIC_BASE_URL !== G1_BASE_URL) {
    throw new Error("NEXT_PUBLIC_BASE_URL must be the deterministic G1 origin");
  }
  const out = process.env.G1_CAPTURE_OUT;
  const label = process.env.G1_CAPTURE_LABEL;
  if (!out || !isAbsolute(out) || !label || !/^[a-z0-9-]{1,40}$/u.test(label)) {
    throw new Error("G1_CAPTURE_OUT (absolute path) and G1_CAPTURE_LABEL are required");
  }
  return { out, label };
}

type Handlers = {
  ready: () => Promise<Response>;
  health: () => Response;
  atom: () => Promise<Response>;
  llms: () => Response;
  openapiYaml: (request: Request) => Response;
  openapiJson: (request: Request) => Response;
  disconnect: () => Promise<void>;
};

let config: { out: string; label: string };
let handlers: Handlers;

beforeAll(async () => {
  config = captureConfig();
  vi.stubGlobal("fetch", () => {
    throw new Error("External HTTP is blocked in the G1 capture");
  });
  const [ready, health, atom, llms, yaml, json, db] = await Promise.all([
    import("@/app/api/health/ready/route"),
    import("@/app/api/health/route"),
    import("@/app/api/feeds/atom/route"),
    import("@/app/llms.txt/route"),
    import("@/app/openapi.yaml/route"),
    import("@/app/openapi.json/route"),
    import("@/lib/db"),
  ]);
  handlers = {
    ready: ready.GET,
    health: health.GET,
    atom: atom.GET,
    llms: llms.GET,
    openapiYaml: yaml.GET,
    openapiJson: json.GET,
    disconnect: () => db.prisma.$disconnect(),
  };
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await handlers?.disconnect();
});

function request(id: string, path: string, headers: Record<string, string> = {}): CapturedRequest {
  return { id, method: "GET", path, headers };
}

function toFetchRequest(captured: CapturedRequest): Request {
  return new Request(`${G1_BASE_URL}${captured.path}`, {
    method: captured.method,
    headers: captured.headers,
  });
}

function etagOf(response: CapturedResponse): string {
  const etag = response.headers.find(([name]) => name === "etag")?.[1];
  if (!etag) throw new Error(`${response.id} did not return an ETag`);
  return etag;
}

async function captureAll(): Promise<CapturedResponse[]> {
  const responses: CapturedResponse[] = [];
  const add = async (captured: CapturedRequest, response: Response | Promise<Response>) => {
    responses.push(await captureResponse(captured, await response));
    return responses.at(-1)!;
  };
  await add(request("health-ready", "/api/health/ready"), handlers.ready());
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  try {
    await add(request("health", "/api/health"), handlers.health());
  } finally {
    vi.useRealTimers();
  }
  await add(request("feeds-atom", "/api/feeds/atom"), handlers.atom());
  await add(request("llms-txt", "/llms.txt"), handlers.llms());
  const yamlRequest = request("openapi-yaml", "/openapi.yaml");
  const yaml = await add(yamlRequest, handlers.openapiYaml(toFetchRequest(yamlRequest)));
  const yaml304 = request("openapi-yaml-304", "/openapi.yaml", { "if-none-match": etagOf(yaml) });
  await add(yaml304, handlers.openapiYaml(toFetchRequest(yaml304)));
  const jsonRequest = request("openapi-json", "/openapi.json");
  const json = await add(jsonRequest, handlers.openapiJson(toFetchRequest(jsonRequest)));
  const json304 = request("openapi-json-304", "/openapi.json", { "if-none-match": etagOf(json) });
  await add(json304, handlers.openapiJson(toFetchRequest(json304)));
  return responses;
}

function captureFile(responses: CapturedResponse[]): CaptureFile {
  return {
    version: G1_CAPTURE_VERSION,
    label: config.label,
    baseUrl: G1_BASE_URL,
    clock: G1_FIXED_CLOCK,
    principal: "anonymous",
    responses,
  };
}

describe("G1 T-PUB public-route capture (restricted public role, real handlers)", () => {
  it("captures non-degraded, repeatable responses and writes them for comparison", async () => {
    const first = captureFile(await captureAll());
    const second = captureFile(await captureAll());
    // Within-run repeatability: any nondeterminism would make before/after equality meaningless.
    expect(comparePairedCaptures(first, second)).toEqual([]);
    const statuses = Object.fromEntries(first.responses.map((r) => [r.id, r.status]));
    expect(statuses).toEqual({
      "health-ready": 200,
      health: 200,
      "feeds-atom": 200,
      "llms-txt": 200,
      "openapi-yaml": 200,
      "openapi-yaml-304": 304,
      "openapi-json": 200,
      "openapi-json-304": 304,
    });
    mkdirSync(dirname(config.out), { recursive: true });
    writeFileSync(config.out, `${JSON.stringify(first, null, 2)}\n`, { mode: 0o600 });
  });
});
