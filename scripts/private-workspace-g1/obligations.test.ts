import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { methodObligations } from "./obligations.js";
import { NO_SESSION, PRINCIPAL_LABELS } from "./principals.js";
import { SCENARIOS, type HttpScenario } from "./scenarios.js";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function app(files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "oratlas-g1-methods-"));
  temporary.push(directory);
  for (const [file, text] of Object.entries(files)) {
    const path = join(directory, file);
    mkdirSync(resolve(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }
  return directory;
}
const scenario = (
  principal: HttpScenario["principal"],
  method: HttpScenario["method"] = "GET",
  status = 200,
): HttpScenario => ({
  kind: "http",
  id: `${method}-${principal}`,
  route: "api/example",
  method,
  path: "/api/example",
  principal,
  session: NO_SESSION,
  expect: {
    status,
    ...(status >= 400 ? { denial: { code: "not-found", message: "Missing" } } : {}),
  },
});

describe("G1 method and channel obligations", () => {
  it("keeps an unexercised POST visible when all six principals exercise GET", () => {
    const result = methodObligations(
      app({ "api/example/route.ts": "export const GET = handler; export const POST = handler;" }),
      PRINCIPAL_LABELS.map((principal) => scenario(principal)),
    );
    expect(result.routeMethods).toBe(2);
    expect(result.routeMethodsWithScenarios).toBe(1);
    expect(result.routeMethodsWithAllPrincipalCases).toBe(1);
    expect(result.methods.find((entry) => entry.method === "POST")?.missingPrincipals).toEqual([
      ...PRINCIPAL_LABELS,
    ]);
    expect(result.status).toContain("not G1 acceptance");
  });

  it("does not turn six missing-only scenarios into a successful method case", () => {
    const result = methodObligations(
      app({ "api/example/route.ts": "export async function GET() {}" }),
      PRINCIPAL_LABELS.map((principal) => scenario(principal, "GET", 404)),
    );
    expect(result.routeMethodsWithAllPrincipalCases).toBe(1);
    expect(result.routeMethodsWithSuccessScenarios).toBe(0);
    expect(result.methods[0]?.denialScenarioIds).toHaveLength(6);
  });

  it("reports unknown method scenarios and unresolved wildcard exports without executing source", () => {
    const result = methodObligations(
      app({
        "api/example/route.ts":
          "throw new Error('must not execute'); export * from './untrusted'; export { handler as GET };",
      }),
      [scenario("anonymous", "POST")],
    );
    expect(result.unresolvedExports).toEqual(["api/example/route.ts"]);
    expect(result.undeclaredScenarioOperations).toEqual(["POST-anonymous"]);
  });

  it("inventories rendered surfaces separately and excludes only the private route namespace", () => {
    const result = methodObligations(
      app({
        "page.tsx": "export default function Page() {}",
        "layout.tsx": "",
        "robots.ts": "",
        "api/private/route.ts": "export const GET = handler;",
        "api/private/object/route.ts": "export const GET = handler;",
        "api/privately/route.ts": "export const GET = handler;",
      }),
      [],
    );
    expect(result.methods.map((entry) => entry.route)).toEqual(["api/privately"]);
    expect(result.renderedSurfaces).toEqual(["layout.tsx", "page.tsx", "robots.ts"]);
    expect(result.renderedSurfaceStatus).toContain("separate real Next");
  });

  it("maps the current program to declared methods and exposes its residual work", () => {
    const result = methodObligations(resolve(process.cwd(), "apps/web/src/app"), SCENARIOS);
    expect(result.unresolvedExports).toEqual([]);
    expect(result.undeclaredScenarioOperations).toEqual([]);
    expect(result.routeMethods).toBeGreaterThan(133);
    expect(result.routeMethodsWithScenarios).toBeLessThan(result.routeMethods);
    expect(result.routeMethodsWithAllPrincipalCases).toBeLessThan(result.routeMethodsWithScenarios);
    expect(result.renderedSurfaces.length).toBeGreaterThan(30);
  });
});
