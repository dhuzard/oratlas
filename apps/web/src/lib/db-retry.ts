/**
 * Retry helpers for serializable SQLite transactions. Shared by every module
 * that writes editorial or publication state; retry classification must stay
 * identical across them.
 */

export async function withSqliteRetry<T>(
  operation: () => Promise<T>,
  isDomainError: (error: unknown) => boolean,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (isDomainError(error) || attempt >= 3 || !isRetriableSqliteError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
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
