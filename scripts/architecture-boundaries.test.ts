import { readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

function workspacePath(path: string): string {
  return relative(ROOT, path).replaceAll("\\", "/");
}

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["generated", "node_modules", ".next", "dist", "coverage"].includes(entry.name)) {
        files.push(...sourceFiles(path));
      }
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name)) && !TEST_FILE.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function moduleSpecifiers(path: string): string[] {
  const source = ts.createSourceFile(
    workspacePath(path),
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      specifiers.push(node.arguments[0]!.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

function resolvedWorkspaceImport(importer: string, specifier: string): string | undefined {
  if (specifier.startsWith(".")) return workspacePath(resolve(dirname(importer), specifier));
  if (specifier.startsWith("apps/") || specifier.startsWith("packages/")) return specifier;
  return undefined;
}

function importsApplicationInternals(importer: string, specifier: string): boolean {
  if (specifier === "@" || specifier.startsWith("@/")) return true;
  return resolvedWorkspaceImport(importer, specifier)?.startsWith("apps/") === true;
}

describe("architecture import boundaries", () => {
  it("keeps packages and root scripts independent from application internals", () => {
    const violations: string[] = [];
    for (const scope of ["packages", "scripts"] as const) {
      for (const file of sourceFiles(resolve(ROOT, scope))) {
        for (const specifier of moduleSpecifiers(file)) {
          if (importsApplicationInternals(file, specifier)) {
            violations.push(`${workspacePath(file)} -> ${specifier}`);
          }
        }
      }
    }
    expect(violations.sort()).toEqual([]);
  });

  it("keeps Prisma and Next.js out of framework-free packages", () => {
    const violations: string[] = [];
    for (const file of sourceFiles(resolve(ROOT, "packages"))) {
      const path = workspacePath(file);
      const packageName = path.split("/")[1];
      for (const specifier of moduleSpecifiers(file)) {
        const resolved = resolvedWorkspaceImport(file, specifier);
        const importsPrisma =
          specifier === "prisma" ||
          specifier.startsWith("prisma/") ||
          specifier === "@prisma/client" ||
          specifier.startsWith("@prisma/client/") ||
          resolved?.startsWith("packages/db/generated/") === true;
        const importsNext =
          specifier === "next" || specifier.startsWith("next/") || specifier === "server-only";
        if ((packageName !== "db" && importsPrisma) || importsNext) {
          violations.push(`${path} -> ${specifier}`);
        }
        if (packageName === "contracts" && specifier.startsWith("@oratlas/")) {
          violations.push(`${path} -> ${specifier}`);
        }
      }
    }
    expect(violations.sort()).toEqual([]);
  });

  it("keeps workspace package dependencies acyclic", () => {
    const packageDirectories = readdirSync(resolve(ROOT, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(ROOT, "packages", entry.name));
    const graph = new Map<string, string[]>();
    for (const directory of packageDirectories) {
      const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
        name: string;
        dependencies?: Record<string, string>;
      };
      graph.set(
        manifest.name,
        Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@oratlas/")),
      );
    }

    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (name: string, path: string[]): void => {
      if (visiting.has(name))
        throw new Error(`Workspace dependency cycle: ${[...path, name].join(" -> ")}`);
      if (visited.has(name)) return;
      visiting.add(name);
      for (const dependency of graph.get(name) ?? []) visit(dependency, [...path, name]);
      visiting.delete(name);
      visited.add(name);
    };
    for (const name of graph.keys()) visit(name, []);
    expect(visited).toEqual(new Set(graph.keys()));
  });
});
