import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runAtlasCheckCli } from "./cli.js";

describe("Atlas Check CLI", () => {
  it("returns usage status 2 for invalid options", async () => {
    let stderr = "";
    const status = await runAtlasCheckCli(["--format", "xml"], {
      stdout: () => undefined,
      stderr: (value) => {
        stderr += value;
      },
    });
    expect(status).toBe(2);
    expect(stderr).toContain("--format must be json, github, or text");
  });

  it("writes reports only to regular files inside the repository root", async () => {
    const root = await mkdtemp(join(tmpdir(), "oratlas-check-cli-"));
    try {
      await mkdir(join(root, "reports"));
      const status = await runAtlasCheckCli([
        "--root",
        root,
        "--format",
        "json",
        "--output",
        "reports/check.json",
        "--fail-on",
        "never",
      ]);
      expect(status).toBe(0);
      expect(JSON.parse(await readFile(join(root, "reports", "check.json"), "utf8"))).toMatchObject(
        {
          schemaVersion: "1.0.0",
        },
      );

      expect(await runAtlasCheckCli(["--root", root, "--output", "../outside.json"])).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a report-file symlink", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "oratlas-check-symlink-"));
    const outside = join(tmpdir(), `oratlas-check-outside-${process.pid}.json`);
    try {
      await symlink(outside, join(root, "report.json"));
      expect(await runAtlasCheckCli(["--root", root, "--output", "report.json"])).toBe(2);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });
});
