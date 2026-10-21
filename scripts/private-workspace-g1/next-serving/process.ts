import { readFileSync, writeFileSync } from "node:fs";
import { spawn, type ChildProcess } from "node:child_process";
import { createConnection } from "node:net";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { nextServingEnvironment } from "./environment.js";

const delay = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const alive = (child: ChildProcess) => child.exitCode === null && child.signalCode === null;
const portOpen = (port: number) =>
  new Promise<boolean>((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
    socket.setTimeout(200, () => {
      socket.destroy();
      done(false);
    });
  });
export type NextServer = {
  readonly child: ChildProcess;
  readonly logs: () => string;
  readonly stop: () => Promise<void>;
};

/** Fresh real Next production server. POSIX process groups only; Windows is explicitly unsupported. */
export async function startNextServer(input: {
  root: string;
  node: string;
  databaseUrl: string;
  output: string;
  port: number;
  readyTimeoutMs?: number;
}): Promise<NextServer> {
  if (process.platform === "win32") throw new Error("POSIX process-group lifecycle required");
  if (!Number.isInteger(input.port) || input.port < 1024 || input.port > 65535)
    throw new Error("Invalid loopback port");
  if (await portOpen(input.port)) throw new Error("Loopback port already occupied");
  const buildId = readFileSync(resolve(input.root, "apps/web/.next/BUILD_ID"), "utf8").trim();
  if (!/^[A-Za-z0-9_-]{1,200}$/u.test(buildId))
    throw new Error("Prepared Next production build required");
  const child = spawn(
    input.node,
    [
      resolve(input.root, "apps/web/node_modules/next/dist/bin/next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(input.port),
    ],
    {
      cwd: resolve(input.root, "apps/web"),
      env: nextServingEnvironment(input.databaseUrl, input.root, input.output),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  let spawnError = false;
  child.on("error", () => {
    spawnError = true;
  });
  const collect = (chunk: Buffer) => {
    logs = (logs + chunk.toString("utf8")).slice(-512 * 1024);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  const stop = async () => {
    if (!child.pid) return;
    const signal = (name: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    };
    const groupAlive = () => {
      try {
        process.kill(-child.pid!, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
      }
    };
    signal("SIGTERM");
    const until = performance.now() + 5_000;
    while (alive(child) && performance.now() < until) await delay(25);
    signal("SIGKILL");
    const killedUntil = performance.now() + 5_000;
    while (
      (alive(child) || groupAlive() || (await portOpen(input.port))) &&
      performance.now() < killedUntil
    )
      await delay(25);
    if (alive(child) || groupAlive() || (await portOpen(input.port)))
      throw new Error("Next server failed to become quiescent");
    writeFileSync(`${input.output}.server.log`, logs, { mode: 0o600 });
  };
  try {
    const deadline = performance.now() + (input.readyTimeoutMs ?? 30_000);
    while (performance.now() < deadline) {
      if (spawnError || !alive(child)) throw new Error("Next server exited before readiness");
      // Own-child readiness marker prevents accidentally trusting an unrelated listener.
      if (/Ready in/u.test(logs) && (await portOpen(input.port)))
        return { child, logs: () => logs, stop };
      await delay(50);
    }
    throw new Error("Next readiness deadline exceeded");
  } catch (error) {
    await stop();
    throw error;
  }
}
