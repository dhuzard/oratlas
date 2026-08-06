export interface PrismaRetryPolicy {
  maxAttempts: number;
  isRetryable: (error: unknown) => boolean;
  beforeRetry?: (error: unknown, failedAttemptIndex: number) => Promise<void> | void;
  mapExhaustedError?: (error: unknown) => unknown;
}

/** Execute one operation under an explicit, immutable retry policy. */
export async function withPrismaRetryPolicy<T>(
  operation: () => Promise<T>,
  policy: PrismaRetryPolicy,
): Promise<T> {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new RangeError("A retry policy requires at least one attempt.");
  }
  for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!policy.isRetryable(error)) throw error;
      if (attempt === policy.maxAttempts - 1) {
        throw policy.mapExhaustedError ? policy.mapExhaustedError(error) : error;
      }
      await policy.beforeRetry?.(error, attempt);
    }
  }
  throw new Error("Retry policy exhausted without an operation result.");
}

/**
 * Retry helper for SQLite lock/serialization contention. Domain errors remain
 * terminal and the historical four-attempt exponential-delay budget is kept.
 */

export async function withSqliteRetry<T>(
  operation: () => Promise<T>,
  isDomainError: (error: unknown) => boolean,
): Promise<T> {
  return withPrismaRetryPolicy(operation, {
    maxAttempts: 4,
    isRetryable: (error) => !isDomainError(error) && isRetriableSqliteError(error),
    beforeRetry: (_error, failedAttemptIndex) =>
      new Promise((resolve) => setTimeout(resolve, 25 * 2 ** failedAttemptIndex)),
  });
}

export function isRetriableSqliteError(error: unknown): boolean {
  const code = prismaCode(error);
  const message = error instanceof Error ? error.message : "";
  return code === "P1008" || code === "P2034" || /database is locked|SQLITE_BUSY/i.test(message);
}

export function prismaCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export function uniqueTargets(error: unknown): string[] {
  if (typeof error !== "object" || error === null || !("meta" in error)) return [];
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (Array.isArray(target)) return target.map(String);
  return target === undefined ? [] : [String(target)];
}
