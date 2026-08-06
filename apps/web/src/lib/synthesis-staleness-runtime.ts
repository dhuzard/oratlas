import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@oratlas/db";
import type { SessionUser } from "./auth";
import {
  SYNTHESIS_STALENESS_SERIALIZABLE_ATTEMPTS,
  SynthesisStalenessError,
} from "./synthesis-staleness-contract";

export function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function assertEditor(actor: SessionUser): void {
  if (actor.role !== "EDITOR" && actor.role !== "ADMIN") {
    throw new SynthesisStalenessError("Editor role required.", "forbidden");
  }
}

export async function runSerializable<T>(
  client: PrismaClient,
  operation: () => Promise<T>,
): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < SYNTHESIS_STALENESS_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        (error.code !== "P2034" && error.code !== "P2002") ||
        attempt === SYNTHESIS_STALENESS_SERIALIZABLE_ATTEMPTS - 1
      )
        throw error;
    }
  }
  throw last;
}
