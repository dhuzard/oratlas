/**
 * Deterministic SQLite recovery drill.
 *
 * Creates a database in a drill-owned temporary directory, seeds it, captures
 * byte-for-byte public API responses, backs it up, deletes only the validated
 * database files, restores it, and verifies the same responses after restart.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const require = createRequire(import.meta.url);

export const PUBLIC_API_PATHS = [
  "/api/reviews/hippocampal-replay-computational-review",
  "/api/nodes?page=1&pageSize=5",
  "/api/graph?depth=1&limit=10",
] as const;

export function assertInside(parent: string, candidate: string): void {
  const parentPath = resolve(parent);
  const candidatePath = resolve(candidate);
  const pathFromParent = relative(parentPath, candidatePath);
  if (!pathFromParent || pathFromParent === ".." || pathFromParent.startsWith(`..${sep}`)) {
    throw new Error(`Refusing to operate outside the drill directory: ${candidatePath}`);
  }
}

export function assertEqualSnapshots(
  before: ReadonlyMap<string, Uint8Array>,
  after: ReadonlyMap<string, Uint8Array>,
): void {
  for (const path of PUBLIC_API_PATHS) {
    const expected = before.get(path);
    const actual = after.get(path);
    if (!expected || !actual || !Buffer.from(expected).equals(Buffer.from(actual))) {
      throw new Error(`Public API output diverged after restore: ${path}`);
    }
  }
}

function run(commandName: string, args: string[], env: NodeJS.ProcessEnv): void {
  const result = spawnSync(commandName, args, {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${commandName} ${args.join(" ")} exited with ${String(result.status)}`);
  }
}

function runPnpm(args: string[], env: NodeJS.ProcessEnv): void {
  const pnpmScript = process.env.npm_execpath;
  if (pnpmScript) {
    run(process.execPath, [pnpmScript, ...args], env);
    return;
  }
  run("pnpm", args, env);
}

async function waitForReady(baseUrl: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Web server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health/ready`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error("Timed out waiting for the restored application to become ready");
}

async function startServer(env: NodeJS.ProcessEnv, port: number): Promise<ChildProcess> {
  const nextBin = require.resolve("next/dist/bin/next", { paths: [join(repoRoot, "apps/web")] });
  const child = spawn(process.execPath, [nextBin, "start", "apps/web", "-p", String(port)], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  await waitForReady(`http://127.0.0.1:${port}`, child);
  return child;
}

async function stopServer(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function capture(baseUrl: string): Promise<Map<string, Uint8Array>> {
  const snapshots = new Map<string, Uint8Array>();
  for (const path of PUBLIC_API_PATHS) {
    const response = await fetch(`${baseUrl}${path}`);
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
    snapshots.set(path, new Uint8Array(await response.arrayBuffer()));
  }
  return snapshots;
}

function destroyDatabase(drillDir: string, databasePath: string): void {
  assertInside(drillDir, databasePath);
  const databaseName = databasePath.slice(databasePath.lastIndexOf(sep) + 1);
  for (const entry of readdirSync(drillDir)) {
    if (
      entry === databaseName ||
      entry === `${databaseName}-journal` ||
      entry === `${databaseName}-wal` ||
      entry === `${databaseName}-shm`
    ) {
      const target = join(drillDir, entry);
      assertInside(drillDir, target);
      unlinkSync(target);
    }
  }
  if (existsSync(databasePath)) throw new Error("Loss simulation did not remove the database");
}

async function main(): Promise<void> {
  const configuredRoot = process.env.ORATLAS_DRILL_TEMP_ROOT;
  const tempRoot = resolve(configuredRoot || tmpdir());
  if (configuredRoot && !isAbsolute(configuredRoot)) {
    throw new Error("ORATLAS_DRILL_TEMP_ROOT must be an absolute path");
  }
  mkdirSync(tempRoot, { recursive: true });
  const drillDir = mkdtempSync(join(tempRoot, "oratlas-backup-restore-"));
  assertInside(tempRoot, drillDir);
  const databasePath = join(drillDir, "drill.db");
  const backupPath = join(drillDir, "drill.db.bak");
  const port = Number(process.env.ORATLAS_DRILL_PORT || 31_000 + (process.pid % 10_000));
  const baseUrl = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DATABASE_URL: `file:${databasePath.replaceAll("\\", "/")}`,
    SESSION_SECRET: "backup-restore-drill-session-secret",
    LLM_PROVIDER: "",
    LLM_MODEL: "",
    ANTHROPIC_API_KEY: "",
  };
  let server: ChildProcess | undefined;

  try {
    runPnpm(["--filter", "@oratlas/db", "db:push"], env);
    runPnpm(["--filter", "@oratlas/db", "db:seed"], env);
    server = await startServer(env, port);
    const before = await capture(baseUrl);
    await stopServer(server);
    server = undefined;

    runPnpm(["backup", "--", "--output", backupPath], env);
    destroyDatabase(drillDir, databasePath);
    runPnpm(["restore", backupPath], env);

    server = await startServer(env, port);
    const after = await capture(baseUrl);
    assertEqualSnapshots(before, after);
    console.info(
      `✓ Backup/restore drill preserved ${PUBLIC_API_PATHS.length} public API responses byte-for-byte.`,
    );
  } finally {
    await stopServer(server);
    assertInside(tempRoot, drillDir);
    rmSync(drillDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
