import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  activeNextStores,
  installAsyncLocalStorage,
  invokeRouteHandler,
  nextInternals,
  PINNED_NEXT_VERSION,
  runInRouteContext,
} from "./next-request-context.js";

// Offline fail-fast tests of the Next request-context adapter with the real `next/headers`
// `cookies()` (no database, no application module, nothing mocked). The AsyncLocalStorage global
// is installed before Next is first required, mirroring the dedicated G1 setup file.
installAsyncLocalStorage();
const fromWeb = createRequire(resolve(process.cwd(), "apps/web/package.json"));
type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
};
let cookies: () => Promise<CookieJar>;

beforeAll(() => {
  cookies = (fromWeb("next/headers") as { cookies: () => Promise<CookieJar> }).cookies;
});

function request(cookie?: string): Request {
  return new Request("https://g1.oratlas.example/api/probe?x=1", {
    headers: cookie === undefined ? {} : { cookie },
  });
}

const tick = () => new Promise((resolvePromise) => setTimeout(resolvePromise, 1));

describe("G1 Next request-context adapter (offline)", () => {
  it("loads the pinned Next internals backed by a real AsyncLocalStorage", () => {
    expect(nextInternals().version).toBe(PINNED_NEXT_VERSION);
    expect(activeNextStores()).toEqual({ work: false, workUnit: false });
  });

  it("gives production cookies() the request cookie inside a run, and nothing outside", async () => {
    const { result, requestStore, workStore } = await runInRouteContext(
      request("oratlas_session=alpha"),
      "/api/probe/route",
      async () => {
        expect(activeNextStores()).toEqual({ work: true, workUnit: true });
        return (await cookies()).get("oratlas_session")?.value;
      },
    );
    expect(result).toBe("alpha");
    expect(requestStore).toMatchObject({ type: "request", phase: "action" });
    expect(workStore).toMatchObject({ route: "/api/probe", isStaticGeneration: false });
    expect(activeNextStores()).toEqual({ work: false, workUnit: false });
    // Outside any run the real cookies() refuses instead of returning an ambient jar.
    expect(() => cookies()).toThrow(/outside a request scope/u);
  });

  it("keeps alternating and overlapping contexts isolated (no cookie bleed)", async () => {
    const observe = (cookie: string | undefined) =>
      runInRouteContext(request(cookie), "/api/probe/route", async () => {
        const seen: Array<string | undefined> = [];
        for (let step = 0; step < 3; step += 1) {
          seen.push((await cookies()).get("oratlas_session")?.value);
          await tick();
        }
        return seen;
      });
    const overlapping = await Promise.all([
      observe("oratlas_session=A"),
      observe("oratlas_session=B"),
      observe(undefined),
      observe("oratlas_session=A"),
    ]);
    expect(overlapping.map((run) => run.result)).toEqual([
      ["A", "A", "A"],
      ["B", "B", "B"],
      [undefined, undefined, undefined],
      ["A", "A", "A"],
    ]);
    const alternating: Array<Array<string | undefined>> = [];
    for (const cookie of ["oratlas_session=B", undefined, "oratlas_session=A"]) {
      alternating.push((await observe(cookie)).result);
    }
    expect(alternating).toEqual([
      ["B", "B", "B"],
      [undefined, undefined, undefined],
      ["A", "A", "A"],
    ]);
    expect(activeNextStores()).toEqual({ work: false, workUnit: false });
  });

  it("merges cookies a handler sets through cookies() into the response, like the route module", async () => {
    const response = await invokeRouteHandler(request(), "/api/probe/route", async () => {
      (await cookies()).set("g1_probe", "1", { path: "/", httpOnly: true });
      return new Response("ok", { status: 201, headers: { "x-probe": "1" } });
    });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("x-probe")).toBe("1");
    expect(response.headers.getSetCookie()).toEqual(["g1_probe=1; Path=/; HttpOnly"]);
    const untouched = await invokeRouteHandler(
      request(),
      "/api/probe/route",
      () => new Response("x"),
    );
    expect(untouched.headers.getSetCookie()).toEqual([]);
  });

  it("fails fast when Next was imported before the AsyncLocalStorage global (fake storage)", () => {
    const directory = mkdtempSync(join(tmpdir(), "oratlas-g1-next-order-"));
    try {
      const script = join(directory, "probe.mts");
      writeFileSync(
        script,
        [
          `import { createRequire } from "node:module";`,
          `const fromWeb = createRequire(${JSON.stringify(resolve(process.cwd(), "apps/web/package.json"))});`,
          `fromWeb("next/headers");`,
          `const adapter = await import(${JSON.stringify(pathToFileURL(resolve(process.cwd(), "scripts/private-workspace-g1/next-request-context.ts")).href)});`,
          `adapter.installAsyncLocalStorage();`,
          `try { adapter.nextInternals(); console.log("LOADED"); } catch (error) { console.log(String(error)); }`,
        ].join("\n"),
      );
      const tsx = join(
        dirname(fromWeb.resolve("tsx/package.json", { paths: [process.cwd()] })),
        "dist/cli.mjs",
      );
      const result = spawnSync(process.execPath, [tsx, script], {
        cwd: process.cwd(),
        env: { PATH: process.env.PATH ?? "", NODE_ENV: "test" },
        encoding: "utf8",
        timeout: 60_000,
      });
      expect(result.stdout).toContain("workAsyncStorage is not a real AsyncLocalStorage");
      expect(result.stdout).not.toContain("LOADED");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("propagates handler errors and leaves no store behind", async () => {
    await expect(
      runInRouteContext(request("oratlas_session=A"), "/api/probe/route", async () => {
        throw new Error("handler failed");
      }),
    ).rejects.toThrow("handler failed");
    expect(activeNextStores()).toEqual({ work: false, workUnit: false });
  });
});
