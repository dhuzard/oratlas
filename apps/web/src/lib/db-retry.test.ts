import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@oratlas/db";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ prisma: {} }));

import {
  BOUNDED_SERIALIZABLE_TRANSACTION_OPTIONS,
  isRetriableSqliteError,
  SERIALIZABLE_TRANSACTION_OPTIONS,
  withPrismaRetryPolicy,
  withSqliteRetry,
} from "./db-retry";
import { runSerializable as runSynthesisEditorial } from "./synthesis-editorial-decisions";
import type { SynthesisEditorialError } from "./synthesis-editorial-contract";
import { runSerializable as runSynthesisStaleness } from "./synthesis-staleness-runtime";

function knownPrismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("retry characterization", {
    code,
    clientVersion: "test",
  });
}

describe("database retry policies", () => {
  it("keeps the shared SQLite budget, classifier, delay, and domain stop rule", async () => {
    const retryable = { code: "P2034" };
    let attempts = 0;
    const timeout = vi.spyOn(globalThis, "setTimeout");
    await expect(
      withSqliteRetry(
        async () => {
          attempts += 1;
          throw retryable;
        },
        () => false,
      ),
    ).rejects.toBe(retryable);
    expect(attempts).toBe(4);
    expect(timeout.mock.calls.map((call) => call[1])).toEqual([25, 50, 100]);
    timeout.mockRestore();

    const domainError = new Error("domain");
    attempts = 0;
    await expect(
      withSqliteRetry(
        async () => {
          attempts += 1;
          throw domainError;
        },
        (error) => error === domainError,
      ),
    ).rejects.toBe(domainError);
    expect(attempts).toBe(1);

    expect(isRetriableSqliteError({ code: "P1008" })).toBe(true);
    expect(isRetriableSqliteError(new Error("SQLITE_BUSY: database is locked"))).toBe(true);
    expect(isRetriableSqliteError({ code: "P2002" })).toBe(false);
  });

  it("runs the generic policy exactly to its declared budget", async () => {
    const terminal = new Error("terminal");
    let attempts = 0;
    await expect(
      withPrismaRetryPolicy(
        async () => {
          attempts += 1;
          throw terminal;
        },
        {
          maxAttempts: 2,
          isRetryable: () => true,
          mapExhaustedError: () => new RangeError("mapped"),
        },
      ),
    ).rejects.toEqual(new RangeError("mapped"));
    expect(attempts).toBe(2);
  });

  it("preserves synthesis editorial retry codes and terminal error translation", async () => {
    let attempts = 0;
    await expect(
      runSynthesisEditorial(async () => {
        attempts += 1;
        throw { code: "P1008" };
      }),
    ).rejects.toMatchObject({
      name: "SynthesisEditorialError",
      code: "conflict",
    } satisfies Partial<SynthesisEditorialError>);
    expect(attempts).toBe(3);

    const terminal = { code: "P9999" };
    attempts = 0;
    await expect(
      runSynthesisEditorial(async () => {
        attempts += 1;
        throw terminal;
      }),
    ).rejects.toBe(terminal);
    expect(attempts).toBe(1);
  });

  it("keeps staleness retries narrower and returns the original terminal error", async () => {
    const race = knownPrismaError("P2034");
    let attempts = 0;
    await expect(
      runSynthesisStaleness({} as PrismaClient, async () => {
        attempts += 1;
        throw race;
      }),
    ).rejects.toBe(race);
    expect(attempts).toBe(3);

    const plainCode = { code: "P2034" };
    attempts = 0;
    await expect(
      runSynthesisStaleness({} as PrismaClient, async () => {
        attempts += 1;
        throw plainCode;
      }),
    ).rejects.toBe(plainCode);
    expect(attempts).toBe(1);
  });

  it("keeps both established transaction option sets byte-stable", () => {
    expect(BOUNDED_SERIALIZABLE_TRANSACTION_OPTIONS).toEqual({
      maxWait: 5_000,
      timeout: 15_000,
      isolationLevel: "Serializable",
    });
    expect(SERIALIZABLE_TRANSACTION_OPTIONS).toEqual({ isolationLevel: "Serializable" });
  });
});
