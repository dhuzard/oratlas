import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { supplementalChannels } from "./supplemental-orchestrator.js";
import { supplementalCandidate, type SupplementalProgram } from "./supplemental-channel.js";
import { captureFromGolden } from "./test-support.js";
import { SCENARIOS } from "./scenarios.js";
import type { G1HarnessDeps } from "./orchestrator.js";
const root = mkdtempSync(join(tmpdir(), "g1-supplemental-controls-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const program: SupplementalProgram = {
  name: "controlled-read",
  spec: "public-routes.g1.spec.ts",
  outVariable: "G1_CAPTURE_OUT",
  scenarios: SCENARIOS.filter((s) => s.id === "openapi-json"),
  addedRows: {},
  stateSuffix: ".state.json",
};
const capture = () => {
  const full = captureFromGolden("unit-control");
  return { ...full, records: full.records.filter((r) => r.id === "openapi-json") };
};
function setup(
  options: { childFails?: boolean; nativeDrift?: boolean; fixtureDrift?: boolean } = {},
) {
  const dir = mkdtempSync(join(root, "run-"));
  const steps: { step: string; ok: boolean }[] = [];
  let queries = 0;
  let children = 0;
  const state = (label: string) => ({
    before: {
      User: [
        {
          id: "synthetic",
          updatedAt: options.nativeDrift && label === "after" ? "2026-04-02" : "2026-04-01",
        },
      ],
    },
  });
  const deps: G1HarnessDeps = {
    runPsql: async () => "",
    queryJson: async <T>() => {
      queries++;
      return { User: options.fixtureDrift && queries % 2 === 0 ? 6 : 5 } as T;
    },
    runSpec: async (_spec, env) => {
      children++;
      if (options.childFails) return false;
      writeFileSync(env.G1_CAPTURE_OUT!, JSON.stringify(capture()));
      writeFileSync(
        env.G1_CAPTURE_OUT! + ".state.json",
        JSON.stringify(state(env.G1_CAPTURE_LABEL!)),
      );
      return true;
    },
  };
  const channels = supplementalChannels({
    programs: [program],
    labels: ["baseline", "after"],
    directory: dir,
    evidenceDir: dir,
    inventoryTables: ["User"],
    admin: {
      host: "127.0.0.1",
      port: 59999,
      database: "oratlas_g1",
      user: "g1_admin",
      password: "synthetic",
    },
    secrets: [],
    deps,
    reset: async () => {},
    childEnv: (key, out, extra) => ({ NODE_ENV: "test", [key]: out, ...extra }),
    record: (step, ok) => {
      steps.push({ step, ok });
    },
  });
  return { dir, channels, steps, children: () => children, state };
}
it("refuses a failed fixed child before accepting any capture or sidecar", async () => {
  const s = setup({ childFails: true });
  await expect(s.channels.capture("baseline")).rejects.toThrow("Supplemental check failed");
  expect(s.children()).toBe(1);
  expect(s.steps.at(-1)).toMatchObject({ ok: false });
  expect(existsSync(join(s.dir, "controlled-read-golden-candidate.json"))).toBe(false);
});
it("refuses undeclared fixture writes before dispatching the child", async () => {
  const s = setup({ fixtureDrift: true });
  await expect(s.channels.capture("baseline")).rejects.toThrow("Supplemental check failed");
  expect(s.children()).toBe(0);
});
it("writes a candidate but never accepts or creates an absent reviewed golden", async () => {
  const s = setup();
  await s.channels.capture("baseline");
  await s.channels.capture("after");
  expect(() => s.channels.compare()).toThrow("Supplemental check failed");
  const path = join(s.dir, "controlled-read-golden-candidate.json");
  expect(JSON.parse(readFileSync(path, "utf8")).http).toBeDefined();
  expect(existsSync(join(s.dir, "baselines", "controlled-read.golden.json"))).toBe(false);
  expect(s.steps.at(-1)?.step).toContain("reviewed golden present");
});
it("rejects native timestamp drift between labels even when HTTP is identical", async () => {
  const s = setup({ nativeDrift: true });
  await s.channels.capture("baseline");
  await s.channels.capture("after");
  expect(() => s.channels.compare()).toThrow("Supplemental check failed");
  expect(s.steps.at(-1)).toEqual({
    step: "controlled-read baseline and after HTTP and complete state identical",
    ok: false,
  });
  expect(
    supplementalCandidate(
      program,
      { capture: capture(), state: s.state("baseline") },
      "unit control",
    ).stateSha256,
  ).toHaveLength(64);
});
