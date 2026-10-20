import { spawn } from "node:child_process";
import { SAFE_IDENTIFIER, type G1Connection } from "./target.js";

/**
 * Minimal `psql` adapter for the G1 harness. No shell: `psql` is spawned directly with fixed
 * arguments, SQL arrives on stdin, and credentials travel only in the child environment
 * (`PGPASSWORD`), never in argv or logs. User/system psqlrc, service and password files are
 * disabled so the connection is exactly the validated one.
 */

export const PSQL_ARGS = [
  "-X",
  "--no-password",
  "-v",
  "ON_ERROR_STOP=1",
  "--quiet",
  "--no-align",
  "--tuples-only",
] as const;

export const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export class PsqlError extends Error {
  override readonly name = "PsqlError";
  constructor(
    message: string,
    readonly exitCode: number | null,
    readonly stderr: string,
  ) {
    super(message);
  }
}

/** Double-quote an identifier after proving it is a plain lower-case identifier. */
export function quoteIdent(identifier: string): string {
  if (!SAFE_IDENTIFIER.test(identifier)) throw new Error("Unsafe SQL identifier refused");
  return `"${identifier}"`;
}

/** Quote a SQL string literal (standard_conforming_strings). NUL bytes are refused. */
export function quoteLiteral(value: string): string {
  if (value.includes("\u0000")) throw new Error("NUL byte in SQL literal refused");
  return `'${value.replaceAll("'", "''")}'`;
}

/** Replace every known secret, and any URL credential, with a fixed marker. */
export function redact(text: string, secrets: readonly string[]): string {
  // Known secrets first (they may contain quotes that would end a URL match early), then URLs.
  let output = text;
  for (const secret of secrets) {
    if (secret.length > 0) output = output.split(secret).join("[redacted]");
  }
  return output.replace(/(postgres(?:ql)?:\/\/)[^\s'"]*/giu, "$1[redacted]");
}

export type PsqlInvocation = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>> & { readonly NODE_ENV: "test" };
};

/**
 * Build the exact child invocation. Only `PATH` is inherited (to locate `psql`); every PG* value is
 * set explicitly so ambient PGHOST/PGSERVICE/PGOPTIONS cannot redirect the connection. `NODE_ENV`
 * is a fixed non-secret value (ignored by psql) so the env satisfies the typed child contract.
 */
export function psqlInvocation(
  connection: G1Connection,
  options: { singleTransaction?: boolean; path?: string } = {},
): PsqlInvocation {
  const args: string[] = [...PSQL_ARGS];
  if (options.singleTransaction) args.push("--single-transaction");
  return {
    command: "psql",
    args,
    env: {
      PATH: options.path ?? process.env.PATH ?? "/usr/bin:/bin",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      NODE_ENV: "test",
      PGHOST: connection.host === "[::1]" ? "::1" : connection.host,
      PGPORT: String(connection.port),
      PGDATABASE: connection.database,
      PGUSER: connection.user,
      PGPASSWORD: connection.password,
      PGAPPNAME: "oratlas-g1-harness",
      PGCONNECT_TIMEOUT: "5",
      PGSSLMODE: "disable",
      PGPASSFILE: "/dev/null",
      PGSERVICEFILE: "/dev/null",
      PGSYSCONFDIR: "/nonexistent-oratlas-g1",
      PGOPTIONS: "-c statement_timeout=30000 -c lock_timeout=5000",
    },
  };
}

/** Run SQL from stdin and return stdout. Rejects with a redacted error on any failure. */
export function runPsql(
  connection: G1Connection,
  sql: string,
  options: {
    singleTransaction?: boolean;
    timeoutMs?: number;
    secrets?: readonly string[];
    path?: string;
  } = {},
): Promise<string> {
  const invocation = psqlInvocation(connection, options);
  const secrets = [connection.password, ...(options.secrets ?? [])];
  return new Promise((resolvePromise, reject) => {
    const child = spawn(invocation.command, [...invocation.args], {
      env: invocation.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error: PsqlError | undefined, output?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolvePromise(output ?? "");
    };
    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        finish(new PsqlError("psql output exceeded the harness limit", null, ""));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new PsqlError("psql timed out", null, ""));
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.on("error", (error) => {
      finish(new PsqlError(`psql could not start: ${redact(error.message, secrets)}`, null, ""));
    });
    child.on("close", (code) => {
      const err = redact(Buffer.concat(stderr).toString("utf8"), secrets);
      if (code === 0) finish(undefined, Buffer.concat(stdout).toString("utf8"));
      else finish(new PsqlError(`psql exited with code ${code}: ${err.trim()}`, code, err));
    });
    child.stdin.on("error", () => undefined);
    child.stdin.end(sql);
  });
}

/** Run SQL whose only output is one JSON value, and parse it. */
export async function queryJson<T>(
  connection: G1Connection,
  sql: string,
  options: { timeoutMs?: number } = {},
): Promise<T> {
  const output = (await runPsql(connection, sql, options)).trim();
  try {
    return JSON.parse(output) as T;
  } catch {
    throw new PsqlError("psql did not return a single JSON value", 0, "");
  }
}
