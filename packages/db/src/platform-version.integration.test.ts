import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client/index.js";
import { PLATFORM_VERSION } from "@oratlas/config";

const databaseName = `platform-version-${process.pid}-${Date.now()}.db`;
const databasePath = resolve(process.cwd(), "packages", "db", "prisma", databaseName);
const databaseUrl = `file:./${databaseName}`;
let prisma: PrismaClient;

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl;
  const prismaArgs = [
    "--filter",
    "@oratlas/db",
    "exec",
    "prisma",
    "db",
    "push",
    "--schema",
    "prisma/schema.prisma",
    "--skip-generate",
  ];
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm";
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", `pnpm ${prismaArgs.join(" ")}`] : prismaArgs;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    encoding: "utf8",
  });
  let provisioned = result.status === 0;
  if (!provisioned && process.platform === "win32") {
    const diffArgs = [
      "--filter",
      "@oratlas/db",
      "exec",
      "prisma",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema-datamodel",
      "prisma/schema.prisma",
      "--script",
    ];
    const diff = spawnSync(command, ["/d", "/s", "/c", `pnpm ${diffArgs.join(" ")}`], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    });
    const sqlite = spawnSync("sqlite3", [databasePath], {
      input: diff.stdout,
      encoding: "utf8",
    });
    provisioned = diff.status === 0 && sqlite.status === 0;
  }
  if (!provisioned) {
    throw new Error(result.error?.message ?? result.stderr ?? result.stdout);
  }
  const db = await import("./index.js");
  prisma = db.getPrisma();
}, 30_000);

afterAll(async () => {
  await prisma?.$disconnect();
  for (const path of [
    databasePath,
    `${databasePath}-journal`,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]) {
    if (existsSync(path)) rmSync(path);
  }
});

describe.sequential("audit platform version", () => {
  it("stamps every direct, bulk, returned-bulk, and transactional event", async () => {
    await prisma.auditEvent.create({
      data: { action: "test.create", subjectType: "test", subjectId: "create" },
    });
    await prisma.auditEvent.createMany({
      data: [{ action: "test.create-many", subjectType: "test", subjectId: "create-many" }],
    });
    await prisma.auditEvent.createManyAndReturn({
      data: [
        {
          action: "test.create-many-return",
          subjectType: "test",
          subjectId: "create-many-return",
        },
      ],
    });
    await prisma.$transaction((tx) =>
      tx.auditEvent.create({
        data: { action: "test.transaction", subjectType: "test", subjectId: "transaction" },
      }),
    );

    const events = await prisma.auditEvent.findMany({ orderBy: { subjectId: "asc" } });
    expect(events).toHaveLength(4);
    expect(events.every((event) => event.platformVersion === PLATFORM_VERSION)).toBe(true);
  });
});
