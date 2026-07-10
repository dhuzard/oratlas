import { PrismaClient } from "../generated/client/index.js";

export * from "../generated/client/index.js";
export type { PrismaClient };

const globalForPrisma = globalThis as unknown as { __oratlasPrisma?: PrismaClient };

/** Singleton Prisma client (safe across Next.js dev hot reloads). */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__oratlasPrisma) {
    globalForPrisma.__oratlasPrisma = new PrismaClient();
  }
  return globalForPrisma.__oratlasPrisma;
}

/** Parse a JSON text column, tolerating null/invalid content. */
export function parseJsonColumn<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
