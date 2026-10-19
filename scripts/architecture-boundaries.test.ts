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

function importsPrismaClient(importer: string, specifier: string): boolean {
  const resolved = resolvedWorkspaceImport(importer, specifier);
  return (
    specifier === "prisma" ||
    specifier.startsWith("prisma/") ||
    specifier === "@prisma/client" ||
    specifier.startsWith("@prisma/client/") ||
    resolved === "packages/db/generated" ||
    resolved?.startsWith("packages/db/generated/") === true
  );
}

// Private-workspace import guard (ADR-0001 §5.1; docs/private-workspace-r0-review.md). A bounded
// static AST check, not the complete T-IMP gate and not proof that a public endpoint cannot reach
// private data. It does not see computed specifiers (`import(variable)`), values laundered through a
// new barrel or app-local module that re-exports under another name, or runtime data flow.
const PUBLIC_APP_ROOT = "apps/web/src";
/** Future private-scoped app locations (ADR-0001 §5.1). Neither exists yet. */
const PRIVATE_APP_PATH = /^apps\/web\/src\/(?:lib\/private|app\/api\/private)(?:\/|$)/u;
const PRIVATE_MODULE_PATHS = [
  /^packages\/knowledge\/src\/(?:private-research-credit|source-credit-[a-z0-9-]+)$/u,
  /^packages\/contracts\/src\/(?:private-research-credit|source-credit-observations)$/u,
  /^packages\/private-workspace(?:\/|$)/u,
  PRIVATE_APP_PATH,
];
/** Working name of the future private client package (ADR-0001 §5.1). */
const PRIVATE_PACKAGE = /^@oratlas\/private-workspace(?:\/|$)/u;
/** Public barrels that legitimately re-export private symbols for packages/tests. */
const PRIVATE_EXPOSING_BARRELS: Readonly<Record<string, string>> = {
  "@oratlas/contracts": "packages/contracts/src/index.ts",
  "@oratlas/knowledge": "packages/knowledge/src/index.ts",
};

function parseSource(path: string, text = readFileSync(path, "utf8")): ts.SourceFile {
  return ts.createSourceFile(workspacePath(path), text, ts.ScriptTarget.Latest, true);
}

/** Workspace-relative module path without extension or `/index`, or undefined for packages. */
function normalizedModulePath(importer: string, specifier: string): string | undefined {
  let path: string | undefined;
  const scoped = /^@oratlas\/([^/]+)\/(.+)$/u.exec(specifier);
  if (specifier.startsWith(".")) path = workspacePath(resolve(dirname(importer), specifier));
  else if (specifier === "@") path = PUBLIC_APP_ROOT;
  else if (specifier.startsWith("@/")) path = `${PUBLIC_APP_ROOT}/${specifier.slice(2)}`;
  else if (specifier.startsWith("apps/") || specifier.startsWith("packages/")) path = specifier;
  else if (scoped) {
    const rest = scoped[2]!.startsWith("src/") ? scoped[2] : `src/${scoped[2]}`;
    path = `packages/${scoped[1]}/${rest}`;
  }
  return path?.replace(/\.[cm]?[jt]sx?$/u, "").replace(/\/index$/u, "");
}

/**
 * Canonical name of a known private-exposing barrel for a specifier, or undefined. Bounded to the
 * explicit known barrels: the bare package name, its package root and `src` directory, and its
 * `src/index` file reached by package subpath, root path or relative path (extension optional).
 */
function barrelName(importer: string, specifier: string): string | undefined {
  if (specifier in PRIVATE_EXPOSING_BARRELS) return specifier;
  const path = normalizedModulePath(importer, specifier);
  if (path === undefined) return undefined;
  for (const [name, barrelFile] of Object.entries(PRIVATE_EXPOSING_BARRELS)) {
    const barrelDirectory = barrelFile.replace(/\/index\.[cm]?[jt]sx?$/u, "");
    if (path === barrelDirectory || path === barrelDirectory.replace(/\/src$/u, "")) return name;
  }
  return undefined;
}

function isDirectPrivateImport(importer: string, specifier: string): boolean {
  if (PRIVATE_PACKAGE.test(specifier)) return true;
  const path = normalizedModulePath(importer, specifier);
  return path !== undefined && PRIVATE_MODULE_PATHS.some((pattern) => pattern.test(path));
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/** Top-level names a private module exports. Star re-exports are refused, not followed. */
function moduleExportNames(path: string): Set<string> {
  const names = new Set<string>();
  for (const statement of parseSource(path).statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause)) {
        throw new Error(`Unsupported star re-export in private module ${workspacePath(path)}`);
      }
      for (const element of statement.exportClause.elements) names.add(element.name.text);
    } else if (ts.isExportAssignment(statement)) {
      names.add("default");
    } else if (hasExportModifier(statement)) {
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
        }
      } else if (
        (ts.isFunctionDeclaration(statement) ||
          ts.isClassDeclaration(statement) ||
          ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement) ||
          ts.isEnumDeclaration(statement)) &&
        statement.name
      ) {
        names.add(statement.name.text);
      }
    }
  }
  return names;
}

/** Names a public barrel re-exports from private modules, derived from its source. */
function barrelPrivateNames(barrel: string): Set<string> {
  const barrelPath = resolve(ROOT, barrel);
  const names = new Set<string>();
  for (const statement of parseSource(barrelPath).statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      !statement.moduleSpecifier ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !isDirectPrivateImport(barrelPath, statement.moduleSpecifier.text)
    ) {
      continue;
    }
    const clause = statement.exportClause;
    if (!clause) {
      const target = normalizedModulePath(barrelPath, statement.moduleSpecifier.text)!;
      for (const name of moduleExportNames(resolve(ROOT, `${target}.ts`))) names.add(name);
    } else if (ts.isNamespaceExport(clause)) {
      names.add(clause.name.text);
    } else {
      for (const element of clause.elements) names.add(element.name.text);
    }
  }
  return names;
}

type BarrelPrivateNames = ReadonlyMap<string, ReadonlySet<string>>;

function barrelPrivateNameMap(): BarrelPrivateNames {
  return new Map(
    Object.entries(PRIVATE_EXPOSING_BARRELS).map(([name, path]) => [
      name,
      barrelPrivateNames(path),
    ]),
  );
}

/**
 * Names selected from a dynamic `import()`/`require()` result when the pattern proves them:
 * `(await import(x)).name`, `const { a, b } = await import(x)`, `require(x).name` or
 * `const { a } = require(x)`. Anything else (`.then`, rest, computed keys, a stored module
 * object) is opaque and returns undefined.
 */
function provenDynamicNames(call: ts.CallExpression): string[] | undefined {
  let expression: ts.Node = call;
  if (call.expression.kind === ts.SyntaxKind.ImportKeyword) {
    if (!ts.isAwaitExpression(call.parent)) return undefined;
    expression = call.parent;
  }
  while (ts.isParenthesizedExpression(expression.parent)) expression = expression.parent;
  const parent = expression.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.expression === expression) {
    return [parent.name.text];
  }
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === expression &&
    ts.isObjectBindingPattern(parent.name)
  ) {
    const names: string[] = [];
    for (const element of parent.name.elements) {
      const key = element.propertyName ?? element.name;
      if (element.dotDotDotToken || !(ts.isIdentifier(key) || ts.isStringLiteral(key))) {
        return undefined;
      }
      names.push(key.text);
    }
    return names;
  }
  return undefined;
}

function privateImportViolations(
  importer: string,
  text: string,
  barrels: BarrelPrivateNames,
): string[] {
  const violations: string[] = [];
  const check = (specifier: string, selected: readonly string[] | undefined): void => {
    if (isDirectPrivateImport(importer, specifier)) {
      violations.push(`${specifier} (private module)`);
      return;
    }
    const barrel = barrelName(importer, specifier);
    const privateNames = barrel === undefined ? undefined : barrels.get(barrel);
    if (!privateNames) return;
    if (selected === undefined) {
      violations.push(`${specifier} (opaque namespace/star/default/dynamic access)`);
      return;
    }
    for (const name of selected) {
      if (name === "default" || privateNames.has(name)) violations.push(`${specifier} { ${name} }`);
    }
  };
  const named = (elements: ts.NodeArray<ts.ImportSpecifier | ts.ExportSpecifier>) =>
    elements.map((element) => (element.propertyName ?? element.name).text);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      if (!clause) check(node.moduleSpecifier.text, []);
      else if (clause.name || (bindings && ts.isNamespaceImport(bindings))) {
        check(node.moduleSpecifier.text, undefined);
      } else check(node.moduleSpecifier.text, bindings ? named(bindings.elements) : []);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      check(
        node.moduleSpecifier.text,
        clause && ts.isNamedExports(clause) ? named(clause.elements) : undefined,
      );
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      check(node.moduleReference.expression.text, undefined);
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length >= 1 &&
      ts.isStringLiteral(node.arguments[0]!) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require"))
    ) {
      // The specifier is the first argument; `import(x, options)` and extra `require` arguments
      // must not hide it.
      check(node.arguments[0]!.text, provenDynamicNames(node));
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    ) {
      let qualifier = node.qualifier;
      while (qualifier && ts.isQualifiedName(qualifier)) qualifier = qualifier.left;
      check(node.argument.literal.text, qualifier ? [qualifier.text] : undefined);
    }
    ts.forEachChild(node, visit);
  };
  visit(parseSource(importer, text));
  return violations;
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
        const importsPrisma = importsPrismaClient(file, specifier);
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

  it("recognizes both the generated Prisma root and its descendants", () => {
    const importer = resolve(ROOT, "packages/knowledge/src/probe.ts");
    expect(importsPrismaClient(importer, "../../db/generated")).toBe(true);
    expect(importsPrismaClient(importer, "../../db/generated/client")).toBe(true);
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
        devDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const dependencyNames = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        ...Object.keys(manifest.optionalDependencies ?? {}),
      ]);
      graph.set(
        manifest.name,
        [...dependencyNames].filter((name) => name.startsWith("@oratlas/")),
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

describe("private-workspace import guard (bounded static check, not complete T-IMP)", () => {
  const barrels = barrelPrivateNameMap();
  const probe = resolve(ROOT, "apps/web/src/lib/probe.ts");
  const violationsFor = (text: string, importer = probe) =>
    privateImportViolations(importer, text, barrels);

  it("derives the private names each public barrel re-exports", () => {
    const knowledge = barrels.get("@oratlas/knowledge")!;
    const contracts = barrels.get("@oratlas/contracts")!;
    for (const name of [
      "projectPersonalResearchCredit",
      "AuthorizePrivateResearchProject",
      "adaptDiggypaperCredit",
      "adaptCRTContributorship",
      "adaptOrcidRoster",
      "SourceCreditAdapterError",
    ]) {
      expect(knowledge.has(name), name).toBe(true);
    }
    for (const name of [
      "privateCrossFindingSchema",
      "PrivateCrossFinding",
      "CREDIT_ROLE_LABELS",
      "sourceCreditObservationsSchema",
      "SourceCreditObservations",
    ]) {
      expect(contracts.has(name), name).toBe(true);
    }
    for (const name of ["buildEvidencePacket", "discussWithLlm"]) {
      expect(knowledge.has(name), name).toBe(false);
    }
    for (const name of ["CREDIT_ROLES", "creditRoleSchema", "createVerifierSchema"]) {
      expect(contracts.has(name), name).toBe(false);
    }
  });

  it("keeps public application modules away from private modules and barrel symbols", () => {
    const violations: string[] = [];
    const files = sourceFiles(resolve(ROOT, PUBLIC_APP_ROOT));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      if (PRIVATE_APP_PATH.test(workspacePath(file))) continue;
      for (const violation of privateImportViolations(file, readFileSync(file, "utf8"), barrels)) {
        violations.push(`${workspacePath(file)} -> ${violation}`);
      }
    }
    expect(violations.sort()).toEqual([]);
  });

  it.each([
    ["named projector", `import { projectPersonalResearchCredit } from "@oratlas/knowledge";`],
    ["aliased adapter", `import { adaptOrcidRoster as roster } from "@oratlas/knowledge";`],
    ["type-only import", `import type { PrivateCrossFinding } from "@oratlas/contracts";`],
    [
      "inline type specifier",
      `import { type SourceCreditObservations } from "@oratlas/contracts";`,
    ],
    ["named re-export", `export { privateCrossFindingSchema as s } from "@oratlas/contracts";`],
    ["star re-export", `export * from "@oratlas/knowledge";`],
    ["namespace re-export", `export * as contracts from "@oratlas/contracts";`],
    ["namespace import", `import * as knowledge from "@oratlas/knowledge";`],
    ["default import", `import knowledge from "@oratlas/knowledge";`],
    ["import-equals", `import knowledge = require("@oratlas/knowledge");`],
    ["opaque dynamic import", `void import("@oratlas/knowledge").then((m) => m);`],
    ["stored dynamic module", `const m = await import("@oratlas/contracts");`],
    [
      "dynamic private member",
      `const f = (await import("@oratlas/knowledge")).projectPersonalResearchCredit;`,
    ],
    [
      "dynamic destructuring",
      `const { adaptCRTContributorship } = await import("@oratlas/knowledge");`,
    ],
    [
      "dynamic rest",
      `const { buildEvidencePacket, ...rest } = await import("@oratlas/knowledge");`,
    ],
    ["opaque require", `const contracts = require("@oratlas/contracts");`],
    ["require member", `const s = require("@oratlas/contracts").sourceCreditObservationsSchema;`],
    ["import type node", `type F = import("@oratlas/contracts").PrivateCrossFinding;`],
    ["typeof import", `type K = typeof import("@oratlas/knowledge");`],
    [
      "relative .js source",
      `import { projectPersonalResearchCredit } from "../../../../packages/knowledge/src/private-research-credit.js";`,
    ],
    ["root path", `export * from "packages/contracts/src/source-credit-observations";`],
    ["package subpath", `import "@oratlas/knowledge/src/source-credit-orcid.js";`],
    [
      "literal dynamic path",
      `void import("../../../../packages/knowledge/src/source-credit-crt");`,
    ],
    ["future private package", `import { client } from "@oratlas/private-workspace";`],
    ["future private subpath", `const c = require("@oratlas/private-workspace/client");`],
    ["@/ private lib", `import { store } from "@/lib/private/store";`],
    ["relative private lib", `import { store } from "./private/index.js";`],
    ["private route", `export { GET } from "@/app/api/private/workspaces/route";`],
    ["direct private dynamic import with options", `void import("@/lib/private/store", {});`],
    [
      "opaque barrel dynamic import with options",
      `void import("@oratlas/knowledge", {}).then((m) => m.projectPersonalResearchCredit);`,
    ],
    [
      "selected private dynamic import with options",
      `const { adaptOrcidRoster } = await import("@oratlas/knowledge", {});`,
    ],
    [
      "selected private member with options",
      `const f = (await import("@oratlas/contracts", {})).privateCrossFindingSchema;`,
    ],
    ["require with extra arguments", `const k = require("@oratlas/knowledge", {});`],
    [
      "relative barrel named import",
      `import { projectPersonalResearchCredit } from "../../../../packages/knowledge/src/index.js";`,
    ],
    [
      "relative barrel alias import",
      `import { adaptOrcidRoster as roster } from "../../../../packages/knowledge/src/index";`,
    ],
    [
      "relative barrel type import",
      `import type { PrivateCrossFinding } from "../../../../packages/contracts/src/index.js";`,
    ],
    [
      "relative barrel re-export",
      `export { sourceCreditObservationsSchema as s } from "../../../../packages/contracts/src";`,
    ],
    ["root barrel star re-export", `export * from "packages/knowledge/src/index.ts";`],
    ["package src index namespace", `import * as k from "@oratlas/knowledge/src/index.js";`],
    [
      "package index subpath",
      `import { adaptCRTContributorship } from "@oratlas/knowledge/index";`,
    ],
    [
      "package root path dynamic",
      `const { projectPersonalResearchCredit } = await import("packages/knowledge");`,
    ],
  ])("flags %s", (_label, text) => {
    expect(violationsFor(text)).not.toEqual([]);
  });

  it.each([
    [
      "public named import",
      `import { buildEvidencePacket, discussWithLlm } from "@oratlas/knowledge";`,
    ],
    [
      "public CRediT taxonomy",
      `import { CREDIT_ROLES, creditRoleSchema } from "@oratlas/contracts";`,
    ],
    ["public re-export", `export { canonicalJson } from "@oratlas/knowledge";`],
    ["side-effect barrel import", `import "@oratlas/contracts";`],
    [
      "comments and strings",
      `// import { projectPersonalResearchCredit } from "@oratlas/knowledge";\n` +
        `/* export * from "@oratlas/private-workspace"; */\n` +
        `const text = 'import("@oratlas/knowledge").projectPersonalResearchCredit';`,
    ],
    [
      "proven dynamic member",
      `const schema = (await import("@oratlas/contracts")).createVerifierSchema;`,
    ],
    [
      "proven dynamic destructuring",
      `const { canonicalJson } = await import("@oratlas/knowledge");`,
    ],
    ["proven require member", `const roles = require("@oratlas/contracts").CREDIT_ROLES;`],
    ["public import type node", `type C = import("@oratlas/contracts").CreditRole;`],
    ["lookalike lib path", `import { x } from "@/lib/private-snapshot-visibility";`],
    ["lookalike package", `import { x } from "@oratlas/private-workspaces-docs";`],
    [
      "lookalike source module",
      `import { x } from "packages/knowledge/src/private-research-credits";`,
    ],
    ["public subpath", `import { canonicalJson } from "@oratlas/contracts/canonical-json";`],
    [
      "public selected dynamic import with options",
      `const { canonicalJson } = await import("@oratlas/knowledge", {});`,
    ],
    [
      "public relative barrel import",
      `import { buildEvidencePacket } from "../../../../packages/knowledge/src/index.js";`,
    ],
    ["public root barrel import", `import { CREDIT_ROLES } from "packages/contracts/src/index";`],
    [
      "public package src index import",
      `import { canonicalJson } from "@oratlas/knowledge/src/index.js";`,
    ],
    [
      "public relative barrel dynamic member",
      `const r = (await import("../../../../packages/contracts/src/index.js")).CREDIT_ROLES;`,
    ],
  ])("allows %s", (_label, text) => {
    expect(violationsFor(text)).toEqual([]);
  });

  it("exempts only the future private app namespace from the scan, by whole path segment", () => {
    expect(PRIVATE_APP_PATH.test("apps/web/src/lib/private/store.ts")).toBe(true);
    expect(PRIVATE_APP_PATH.test("apps/web/src/app/api/private/route.ts")).toBe(true);
    expect(PRIVATE_APP_PATH.test("apps/web/src/lib/private-snapshot-visibility.ts")).toBe(false);
    expect(PRIVATE_APP_PATH.test("apps/web/src/app/api/privately/route.ts")).toBe(false);
  });
});
