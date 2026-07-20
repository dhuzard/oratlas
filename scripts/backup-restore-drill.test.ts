import { describe, expect, it } from "vitest";
import { backupOutputFromArgs } from "./backup.js";
import { assertEqualSnapshots, assertInside, PUBLIC_API_PATHS } from "./backup-restore-drill.js";

describe("backup/restore drill safeguards", () => {
  it("accepts one explicit backup output and rejects ambiguous arguments", () => {
    expect(backupOutputFromArgs([], "/default.bak")).toBe("/default.bak");
    expect(backupOutputFromArgs(["--output", "chosen.bak"], "/default.bak")).toMatch(
      /chosen\.bak$/,
    );
    expect(() => backupOutputFromArgs(["--output"], "/default.bak")).toThrow(
      "requires a filesystem path",
    );
    expect(() =>
      backupOutputFromArgs(["--output", "one", "--output", "two"], "/default.bak"),
    ).toThrow("only be specified once");
  });

  it("permits only descendants of the drill-owned directory", () => {
    expect(() => assertInside("/tmp/drill", "/tmp/drill/database.db")).not.toThrow();
    expect(() => assertInside("/tmp/drill", "/tmp/drill")).toThrow("outside the drill directory");
    expect(() => assertInside("/tmp/drill", "/tmp/user.db")).toThrow("outside the drill directory");
  });

  it("fails on any byte-level public API divergence", () => {
    const before = new Map(PUBLIC_API_PATHS.map((path) => [path, Buffer.from(`same:${path}`)]));
    const after = new Map(before);
    expect(() => assertEqualSnapshots(before, after)).not.toThrow();
    after.set(PUBLIC_API_PATHS[1], Buffer.from("changed"));
    expect(() => assertEqualSnapshots(before, after)).toThrow("diverged after restore");
  });
});
