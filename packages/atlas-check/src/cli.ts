import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isSafeRepoRelativePath } from "@oratlas/contracts";
import { evaluateAtlasRepository } from "./evaluate.js";
import { renderAtlasCheckReport, type AtlasCheckOutputFormat } from "./render.js";

export type FailOn = "error" | "warning" | "never";

interface CliOptions {
  root: string;
  format: AtlasCheckOutputFormat;
  failOn: FailOn;
  output?: string;
  jsonOutput?: string;
  help: boolean;
}

export async function runAtlasCheckCli(
  argv: string[],
  io: { stdout: (value: string) => void; stderr: (value: string) => void } = {
    stdout: (value) => process.stdout.write(value),
    stderr: (value) => process.stderr.write(value),
  },
): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArguments(argv);
  } catch (error) {
    io.stderr(`oratlas-check: ${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (options.help) {
    io.stdout(HELP);
    return 0;
  }
  try {
    const report = await evaluateAtlasRepository({ root: options.root });
    const rendered = renderAtlasCheckReport(report, options.format);
    if (options.output) await writeOutput(options.root, options.output, rendered);
    else io.stdout(rendered);
    if (options.jsonOutput) {
      await writeOutput(options.root, options.jsonOutput, renderAtlasCheckReport(report, "json"));
    }

    if (options.failOn === "never") return 0;
    if (report.summary.errors > 0) return 1;
    if (options.failOn === "warning" && report.summary.warnings > 0) return 1;
    return 0;
  } catch (error) {
    io.stderr(`oratlas-check: ${(error as Error).message}\n`);
    return 2;
  }
}

/** Keep action-generated reports inside the checkout and never follow a report-file symlink. */
async function writeOutput(root: string, path: string, content: string): Promise<void> {
  if (!isSafeRepoRelativePath(path)) {
    throw new Error("Output must be a safe repository-relative path.");
  }
  const canonicalRoot = await realpath(resolve(root));
  const absolute = resolve(canonicalRoot, path);
  const canonicalParent = await realpath(dirname(absolute));
  const parentFromRoot = relative(canonicalRoot, canonicalParent);
  if (
    parentFromRoot === ".." ||
    parentFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(parentFromRoot)
  ) {
    throw new Error("Output directory resolves outside the repository root.");
  }
  try {
    const existing = await lstat(absolute);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new Error("Output path must be a regular file and cannot be a symbolic link.");
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const noFollow = constants.O_NOFOLLOW ?? 0;
  const handle = await open(
    absolute,
    constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    root: process.cwd(),
    format: process.env.GITHUB_ACTIONS === "true" ? "github" : "text",
    failOn: "error",
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") options.help = true;
    else if (argument === "--root") options.root = requiredValue(argv, ++index, "--root");
    else if (argument === "--output") options.output = requiredValue(argv, ++index, "--output");
    else if (argument === "--json-output") {
      options.jsonOutput = requiredValue(argv, ++index, "--json-output");
    } else if (argument === "--format") {
      const value = requiredValue(argv, ++index, "--format");
      if (value !== "json" && value !== "github" && value !== "text") {
        throw new Error("--format must be json, github, or text.");
      }
      options.format = value;
    } else if (argument === "--fail-on") {
      const value = requiredValue(argv, ++index, "--fail-on");
      if (value !== "error" && value !== "warning" && value !== "never") {
        throw new Error("--fail-on must be error, warning, or never.");
      }
      options.failOn = value;
    } else throw new Error(`Unknown argument '${argument ?? ""}'.`);
  }
  return options;
}

function requiredValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

const HELP = `Usage: pnpm atlas-check [options]

Deterministically evaluate TRUST.md, FAIR.md, and review-manifest evidence artifacts.
No repository code, network service, LLM, or imported verification assertion is trusted.

Options:
  --root <directory>        Repository to inspect (default: current directory)
  --format <text|json|github>
                            Output format (default: github in Actions, otherwise text)
  --output <file>           Write the selected format to a file
  --json-output <file>      Also write the canonical JSON report to a file
  --fail-on <error|warning|never>
                            Exit 1 at this threshold (default: error)
  -h, --help                Show this help
`;
