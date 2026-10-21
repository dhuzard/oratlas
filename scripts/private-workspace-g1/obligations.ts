import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { parseRouteHandlerMethods } from "../check-openapi-routes.js";
import { PRINCIPAL_LABELS } from "./principals.js";
import type { Scenario } from "./scenarios.js";

/** Static inventory only. Scenario declarations are not evidence that a capture ran or a gate passed. */
export function methodObligations(appDirectory: string, program: readonly Scenario[]) {
  const routeFiles: string[] = [];
  const renderedSurfaces: string[] = [];
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        const file = relative(appDirectory, path).replaceAll("\\", "/");
        if (file === "api/private/route.ts" || file.startsWith("api/private/")) continue;
        if (entry.name === "route.ts") routeFiles.push(file);
        if (
          /^(page|layout|sitemap|robots|opengraph-image|twitter-image)\.(tsx?|jsx?)$/u.test(
            entry.name,
          )
        ) {
          renderedSurfaces.push(file);
        }
      }
    }
  };
  walk(appDirectory);

  const unresolvedExports: string[] = [];
  const methods = routeFiles.sort().flatMap((file) => {
    const route = file.slice(0, -"/route.ts".length);
    const source = readFileSync(join(appDirectory, file), "utf8");
    const exportedMethods = parseRouteHandlerMethods(source);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    if (
      exportedMethods.length === 0 ||
      ast.statements.some(
        (statement) => ts.isExportDeclaration(statement) && !statement.exportClause,
      )
    )
      unresolvedExports.push(file);
    return exportedMethods.map((method) => {
      const scenarios = program.filter(
        (scenario) =>
          scenario.kind === "http" && scenario.route === route && scenario.method === method,
      );
      const http = scenarios.filter((scenario) => scenario.kind === "http");
      return {
        route,
        method,
        scenarioIds: http.map((scenario) => scenario.id),
        missingPrincipals: PRINCIPAL_LABELS.filter(
          (principal) => !http.some((scenario) => scenario.principal === principal),
        ),
        successScenarioIds: http
          .filter((scenario) => scenario.expect.status >= 200 && scenario.expect.status < 400)
          .map((scenario) => scenario.id),
        denialScenarioIds: http
          .filter((scenario) => scenario.expect.denial !== undefined)
          .map((scenario) => scenario.id),
      };
    });
  });
  const undeclaredScenarioOperations = program.flatMap((scenario) =>
    scenario.kind === "http" &&
    !methods.some((entry) => entry.route === scenario.route && entry.method === scenario.method)
      ? [scenario.id]
      : [],
  );

  return {
    status: "static scenario inventory only; not G1 acceptance" as const,
    routeMethods: methods.length,
    routeMethodsWithScenarios: methods.filter((entry) => entry.scenarioIds.length > 0).length,
    routeMethodsWithAllPrincipalCases: methods.filter(
      (entry) => entry.missingPrincipals.length === 0,
    ).length,
    routeMethodsWithSuccessScenarios: methods.filter((entry) => entry.successScenarioIds.length > 0)
      .length,
    unresolvedExports,
    undeclaredScenarioOperations,
    methods,
    renderedSurfaces: renderedSurfaces.sort(),
    renderedSurfaceStatus:
      "requires separate real Next serving/HTML/metadata capture evidence" as const,
    nonHttpStatus:
      "jobs, CLIs, backups, indexes, logs, metrics, audit, notification delivery, outbound calls and timing require separate evidence" as const,
  };
}
