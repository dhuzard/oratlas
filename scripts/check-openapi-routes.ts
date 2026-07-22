/**
 * API contract drift check.
 *
 * Compares the HTTP method and path of operations declared in
 * `docs/openapi.yaml` against Next.js App Router handlers under
 * `apps/web/src/app/api`. Fails when a real operation is undocumented and
 * warns when a documented operation has no handler.
 */
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";
import ts from "typescript";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "TRACE"] as const;
const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS);

export interface RouteOperation {
  method: string;
  path: string;
}

export function normalizeRoutePath(path: string): string {
  return (
    "/" +
    path
      .split("/")
      .filter((seg) => seg.length > 0)
      .map((seg) => {
        if (/^\{.*\}$/.test(seg)) return "{}";
        if (/^\[.*\]$/.test(seg)) return "{}";
        return seg;
      })
      .join("/")
  );
}

export const CONTRACT_EXCLUDED_ROUTES: readonly string[] = [
  "/api/auth/github/start",
  "/api/auth/github/callback",
];

export interface RouteComparison {
  /** Actual operations with no matching documented method and path. */
  undocumented: RouteOperation[];
  /** Documented operations with no matching actual method and path. */
  missing: RouteOperation[];
}

function operationKey(operation: RouteOperation): string {
  return `${operation.method.toUpperCase()} ${normalizeRoutePath(operation.path)}`;
}

export function compareRoutes(
  documented: RouteOperation[],
  actual: RouteOperation[],
): RouteComparison {
  const documentedKeys = new Set(documented.map(operationKey));
  const actualKeys = new Set(actual.map(operationKey));

  return {
    undocumented: actual.filter((operation) => !documentedKeys.has(operationKey(operation))),
    missing: documented.filter((operation) => !actualKeys.has(operationKey(operation))),
  };
}

/** Parse HTTP operations from the OpenAPI `paths` block. */
export function parseDocumentedOperations(yaml: string): RouteOperation[] {
  const operations: RouteOperation[] = [];
  let inPaths = false;
  let currentPath: string | undefined;

  for (const line of yaml.split(/\r?\n/)) {
    if (!inPaths) {
      if (/^paths:\s*$/.test(line)) inPaths = true;
      continue;
    }
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;

    const pathMatch = line.match(/^ {2}(\/\S+):\s*$/);
    if (pathMatch) {
      const path = pathMatch[1]!;
      currentPath = path.startsWith("/api/") ? path : undefined;
      continue;
    }

    const methodMatch = line.match(/^ {4}(get|post|put|patch|delete|head|options|trace):\s*$/i);
    if (currentPath && methodMatch) {
      operations.push({ method: methodMatch[1]!.toUpperCase(), path: currentPath });
    }
  }

  return operations;
}

/**
 * Find HTTP handler exports in a route module using TypeScript's syntax tree.
 * Covers exported function declarations, exported const handlers, and export
 * specifiers such as `export { handler as GET }` without matching comments or
 * strings that merely mention a handler.
 */
export function parseRouteHandlerMethods(source: string): string[] {
  const sourceFile = ts.createSourceFile("route.ts", source, ts.ScriptTarget.Latest, true);
  const methods = new Set<string>();
  const isExported = (node: ts.Node) =>
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement) && statement.name) {
      if (HTTP_METHOD_SET.has(statement.name.text)) methods.add(statement.name.text);
      continue;
    }
    if (ts.isVariableStatement(statement) && isExported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && HTTP_METHOD_SET.has(declaration.name.text)) {
          methods.add(declaration.name.text);
        }
      }
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.exportClause) {
      if (!ts.isNamedExports(statement.exportClause)) continue;
      for (const specifier of statement.exportClause.elements) {
        if (HTTP_METHOD_SET.has(specifier.name.text)) methods.add(specifier.name.text);
      }
    }
  }

  return [...methods].sort();
}

/** Discover every exported HTTP operation under an App Router API directory. */
export function discoverRouteOperations(apiDir: string, appDir: string): RouteOperation[] {
  const operations: RouteOperation[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === "route.ts") {
        const segments = relative(appDir, dir)
          .split(sep)
          .filter((seg) => seg.length > 0)
          .filter((seg) => !/^\(.*\)$/.test(seg));
        const path = "/" + segments.join("/");
        for (const method of parseRouteHandlerMethods(readFileSync(full, "utf8"))) {
          operations.push({ method, path });
        }
      }
    }
  }

  walk(apiDir);
  return operations.sort((a, b) => operationKey(a).localeCompare(operationKey(b)));
}

function formatOperation(operation: RouteOperation): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, "..");
  const appDir = join(repoRoot, "apps", "web", "src", "app");

  const documented = parseDocumentedOperations(
    readFileSync(join(repoRoot, "docs", "openapi.yaml"), "utf-8"),
  ).sort((a, b) => operationKey(a).localeCompare(operationKey(b)));
  const allOperations = discoverRouteOperations(join(appDir, "api"), appDir);

  const excludedPaths = new Set(CONTRACT_EXCLUDED_ROUTES.map(normalizeRoutePath));
  const actual = allOperations.filter(
    (operation) => !excludedPaths.has(normalizeRoutePath(operation.path)),
  );
  const skipped = allOperations.filter((operation) =>
    excludedPaths.has(normalizeRoutePath(operation.path)),
  );
  const { undocumented, missing } = compareRoutes(documented, actual);

  console.info("OpenAPI contract drift check");
  console.info(`  documented operations: ${documented.length}`);
  console.info(`  route operations:      ${allOperations.length}`);
  console.info(`  in-contract operations: ${actual.length}`);

  if (skipped.length > 0) {
    console.info(`  excluded (infra/auth, not JSON contract): ${skipped.length}`);
    for (const operation of skipped) console.info(`    - ${formatOperation(operation)}`);
  }
  if (missing.length > 0) {
    console.warn(
      `\n⚠ ${missing.length} documented operation(s) with no route handler (stale doc):`,
    );
    for (const operation of missing) console.warn(`    ${formatOperation(operation)}`);
  }
  if (undocumented.length > 0) {
    console.error(`\n✗ ${undocumented.length} route operation(s) missing from docs/openapi.yaml:`);
    for (const operation of undocumented) console.error(`    ${formatOperation(operation)}`);
    console.error("\nDocument these operations in docs/openapi.yaml or the contract has drifted.");
    process.exit(1);
  }

  console.info("\n✓ Every API route operation is documented in docs/openapi.yaml.");
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : "";
if (invokedPath && invokedPath === realpathSync(fileURLToPath(import.meta.url))) main();
