import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../generated/client/index.js";
import {
  applyDatabaseGuards,
  DATABASE_GUARD_TRANSACTION_TIMEOUT_MS,
  POSTGRES_DATABASE_GUARD_SQL,
} from "./database-guards.js";

describe("PostgreSQL guard transaction", () => {
  it("applies every guard in one transaction with an explicit deploy-time timeout", async () => {
    const executed: string[] = [];
    const options: unknown[] = [];
    const client = {
      $transaction: async (
        callback: (tx: { $executeRawUnsafe(sql: string): Promise<number> }) => Promise<void>,
        transactionOptions?: unknown,
      ) => {
        options.push(transactionOptions);
        await callback({
          $executeRawUnsafe: async (sql) => {
            executed.push(sql);
            return 0;
          },
        });
      },
    } as unknown as PrismaClient;

    await applyDatabaseGuards(client, "postgresql");

    expect(options).toEqual([{ maxWait: 30_000, timeout: DATABASE_GUARD_TRANSACTION_TIMEOUT_MS }]);
    expect(DATABASE_GUARD_TRANSACTION_TIMEOUT_MS).toBeGreaterThan(5_000);
    expect(executed).toEqual([...POSTGRES_DATABASE_GUARD_SQL]);
  });
});
