import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { GoldenFile } from "./compare.js";
import {
  capturedIds,
  G1_COVERAGE_STATUS,
  PRINCIPALS,
  SURFACES,
  surfacesForRoute,
} from "./manifest.js";

// Offline: reads the route tree and the reviewed golden file only.
const ROOT = process.cwd();
const APP = resolve(ROOT, "apps/web/src/app");

function routeDirectories(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...routeDirectories(path));
    else if (entry.name === "route.ts") found.push(relative(APP, directory).replaceAll("\\", "/"));
  }
  return found;
}

describe("G1 route/principal coverage manifest", () => {
  const routes = routeDirectories(APP).filter((route) => !route.startsWith("api/private"));

  it("accounts for every public route handler exactly once (gaps stay visible)", () => {
    expect(routes.length).toBeGreaterThan(100);
    const unaccounted = routes.filter((route) => surfacesForRoute(route).length !== 1);
    expect(unaccounted).toEqual([]);
  });

  it("has no stale route references", () => {
    for (const surface of SURFACES) {
      for (const exact of surface.exact ?? []) expect(routes, surface.id).toContain(exact);
      for (const prefix of surface.prefixes ?? []) {
        expect(
          routes.some((route) => route === prefix || route.startsWith(`${prefix}/`)),
          `${surface.id}: ${prefix}`,
        ).toBe(true);
      }
    }
  });

  it("ties captured surfaces to the reviewed golden baseline one-to-one", () => {
    const golden = JSON.parse(
      readFileSync(
        resolve(ROOT, "scripts/private-workspace-g1/baselines/public-routes.golden.json"),
        "utf8",
      ),
    ) as GoldenFile;
    expect([...capturedIds()].sort()).toEqual(golden.routes.map((route) => route.id).sort());
    for (const surface of SURFACES) {
      expect(surface.coverage === "captured-g1-empty", surface.id).toBe(
        (surface.captureIds?.length ?? 0) > 0,
      );
    }
  });

  it("declares partial G1-empty coverage and executes only the anonymous principal", () => {
    expect(G1_COVERAGE_STATUS).toMatch(/^G1-empty partial/);
    expect(PRINCIPALS.map((principal) => principal.label)).toEqual([
      "anonymous",
      "A-only",
      "B-only",
      "A+B",
      "EDITOR",
      "ADMIN",
    ]);
    expect(PRINCIPALS.filter((principal) => principal.executed).map((p) => p.label)).toEqual([
      "anonymous",
    ]);
    for (const principal of PRINCIPALS.filter((p) => !p.executed)) {
      expect(principal.note).toMatch(/Blocking gap/);
    }
    expect(SURFACES.filter((surface) => surface.coverage === "gap").length).toBeGreaterThan(10);
  });
});
