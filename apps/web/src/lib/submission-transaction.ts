import "server-only";
import type { Prisma } from "@oratlas/db";
import { uniqueTargets, withSqliteRetry } from "./db-retry";
import { SubmissionError } from "./submission-contract";

export function withSubmissionSqliteRetry<T>(operation: () => Promise<T>): Promise<T> {
  return withSqliteRetry(operation, (error) => error instanceof SubmissionError);
}

export function uniqueSubmissionTargetLabel(error: unknown): string {
  return uniqueTargets(error).join(", ") || "unknown unique target";
}

export async function claimSubmissionIdempotency(
  tx: Prisma.TransactionClient,
  key: string,
  requestHash?: string,
): Promise<void> {
  await tx.idempotencyKey.create({ data: { key, requestHash } });
}
