import { PrismaClient } from "../generated/client/index.js";
import { PLATFORM_VERSION } from "@oratlas/config";

export * from "./knowledge-node-integrity.js";
export * from "./node-aliases.js";
export * from "./database-guards.js";

export * from "../generated/client/index.js";
export type { PrismaClient };

function stampAuditData<T extends { platformVersion?: string | null }>(data: T): T {
  data.platformVersion = PLATFORM_VERSION;
  return data;
}

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient().$extends({
    name: "oratlas-platform-version",
    query: {
      auditEvent: {
        create({ args, query }) {
          stampAuditData(args.data);
          return query(args);
        },
        createMany({ args, query }) {
          if (Array.isArray(args.data)) args.data.forEach(stampAuditData);
          else stampAuditData(args.data);
          return query(args);
        },
        createManyAndReturn({ args, query }) {
          if (Array.isArray(args.data)) args.data.forEach(stampAuditData);
          else stampAuditData(args.data);
          return query(args);
        },
      },
    },
  });
  // Query extensions intentionally omit a few lifecycle-only methods from
  // their public type. ORAtlas exposes the established PrismaClient surface;
  // the model delegates and transaction behavior are unchanged at runtime.
  return client as unknown as PrismaClient;
}

const globalForPrisma = globalThis as unknown as { __oratlasPrisma?: PrismaClient };

/** Singleton Prisma client (safe across Next.js dev hot reloads). */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__oratlasPrisma) {
    globalForPrisma.__oratlasPrisma = createPrismaClient();
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
