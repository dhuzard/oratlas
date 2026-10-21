import { workerAuthoritySecrets } from "./worker-authority.js";
import { EventEmitter } from "node:events";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { parentLogSecrets, parentLogRefused } from "./parent-log-safety.js";

const stub = vi.hoisted(() => ({
  raw: "",
  separate: false,
  bytes: undefined as undefined | { channel: "stdout" | "stderr"; data: Buffer }[],
}));
vi.mock("node:child_process", () => ({
  spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: vi.fn(),
    });
    queueMicrotask(() => {
      if (stub.bytes) {
        for (const { channel, data } of stub.bytes) child[channel].emit("data", data);
        child.emit("close", 0);
        return;
      }
      const middle = Math.floor(stub.raw.length / 2);
      child.stdout.emit("data", Buffer.from(stub.raw.slice(0, middle)));
      if (stub.separate) {
        child.stderr.emit("data", Buffer.from("interleaved safe diagnostic\n"));
        child.stdout.emit("data", Buffer.from(stub.raw.slice(middle)));
      } else child.stderr.emit("data", Buffer.from(stub.raw.slice(middle)));
      child.emit("close", 0);
    });
    return child;
  },
}));
import { runSpec } from "./orchestrator.js";

const directory = mkdtempSync(join(tmpdir(), "g1-parent-log-test-"));
const urls = ["admin", "public", "private"].map(
  (name) => `postgresql://${name}:quoted%22slash%5C-${name}@127.0.0.1:55464/oratlas_g1_test`,
);
const pool = parentLogSecrets(urls);
const secret = pool.find((value) => value.startsWith("oratlas_session=") && value.includes("."))!;
const unicode = (value: string) =>
  [...value].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
afterEach(() => vi.restoreAllMocks());

it("refuses native-shaped cookie and all three database secrets before every output sink", async () => {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const values = [
    secret,
    secret.split("=")[1]!.split(".").at(-1)!,
    ...urls,
    ...urls.map((url) => decodeURIComponent(new URL(url).password)),
  ];
  for (const value of values) {
    for (const raw of [
      value,
      JSON.stringify({ native: value }),
      `{"native":"${unicode(value)}"}\n`,
    ]) {
      stub.raw = raw;
      const path = join(directory, "child.log");
      const ok = await runSpec(
        "public-routes.g1.spec.ts",
        { NODE_ENV: "test", DATABASE_URL: urls[1]! },
        path,
        urls,
      );
      // Boolean assertions never reveal an injected value through assertion diagnostics.
      expect(ok === false).toBe(true);
      expect(readFileSync(path, "utf8") === "[g1] refused native child log evidence\n").toBe(true);
      expect(write.mock.calls.at(-1)?.[0] === "[g1] refused native child log evidence\n").toBe(
        true,
      );
    }
  }
});

it("inspects each complete channel even when interleaving interrupts escaped JSON", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stub.separate = true;
  stub.raw = `{"native":"${unicode(secret)}"}\n`;
  try {
    expect(
      await runSpec(
        "public-routes.g1.spec.ts",
        { NODE_ENV: "test" },
        join(directory, "separate.log"),
        urls,
      ),
    ).toBe(false);
    expect(
      readFileSync(join(directory, "separate.log"), "utf8") ===
        "[g1] refused native child log evidence\n",
    ).toBe(true);
  } finally {
    stub.separate = false;
  }
});

it("refuses the finite log budget and existing known worker capability guard", async () => {
  vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  for (const raw of [
    "line\n".repeat(4096),
    '"' + "x".repeat(16 * 1024 * 1024) + '"',
    ...workerAuthoritySecrets({ kind: "verifier", credential: "active" }),
  ]) {
    stub.raw = raw;
    expect(
      await runSpec(
        "public-routes.g1.spec.ts",
        { NODE_ENV: "test" },
        join(directory, "bound.log"),
        urls,
      ),
    ).toBe(false);
  }
  // Existing worker-space tests separately enumerate the real capability pool.
  expect(parentLogRefused("safe text\n", urls)).toBe(false);
});

it("preserves safe raw child output exactly at file and console sinks", async () => {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  stub.raw = 'native stdout\n{"safe":"public fixture"}\n\u001b[32mPASS\u001b[0m\n';
  const path = join(directory, "safe.log");
  expect(await runSpec("public-routes.g1.spec.ts", { NODE_ENV: "test" }, path, urls)).toBe(true);
  expect(readFileSync(path, "utf8")).toBe(stub.raw);
  expect(write.mock.calls.at(-1)?.[0]).toBe(stub.raw);
});

it("refuses malformed or truncated native UTF-8 on either stream before output sinks", async () => {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    for (const channel of ["stdout", "stderr"] as const) {
      for (const data of [Buffer.from([0xff]), Buffer.from([0xe2, 0x82])]) {
        stub.bytes = [{ channel, data }];
        const path = join(directory, "invalid-utf8.log");
        expect(await runSpec("public-routes.g1.spec.ts", { NODE_ENV: "test" }, path, urls)).toBe(
          false,
        );
        expect(readFileSync(path, "utf8") === "[g1] refused native child log evidence\n").toBe(
          true,
        );
        expect(write.mock.calls.at(-1)?.[0] === "[g1] refused native child log evidence\n").toBe(
          true,
        );
      }
    }
  } finally {
    stub.bytes = undefined;
  }
});

it("preserves valid UTF-8 multibyte sequences split across native buffer chunks and BOM", async () => {
  const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  const bytes = Buffer.from("\ufeffnative € multibyte 😀\n");
  try {
    // Bytewise chunks deliberately split every multibyte encoding, without changing order.
    stub.bytes = [...bytes].map((byte) => ({
      channel: "stdout" as const,
      data: Buffer.from([byte]),
    }));
    const path = join(directory, "multibyte.log");
    expect(await runSpec("public-routes.g1.spec.ts", { NODE_ENV: "test" }, path, urls)).toBe(true);
    expect(readFileSync(path).equals(bytes)).toBe(true);
    expect(Buffer.from(write.mock.calls.at(-1)?.[0] as string).equals(bytes)).toBe(true);
  } finally {
    stub.bytes = undefined;
  }
});

it("pins the native session payload/HMAC contract without importing app runtime", () => {
  const native = readFileSync(
    new URL("../../apps/web/src/lib/session-token.ts", import.meta.url),
    "utf8",
  );
  expect(native.includes("const payload = `${userId}.${issuedAtMs}`;")).toBe(true);
  expect(native.includes('createHmac("sha256", secret).update(payload).digest("base64url")')).toBe(
    true,
  );
  rmSync(directory, { recursive: true, force: true });
});
