import { Prisma } from "../generated/client/index.js";

export interface CanonicalClaimBinding {
  id: string;
  knowledgeNodeId: string;
}

export interface CanonicalCitationBinding {
  id: string;
  knowledgeNodeId: string;
  workId: string;
  expectedKnowledgeNodeId: string | null;
  expectedWorkId: string | null;
}

export interface CanonicalEvidenceRelationBinding {
  id: string;
  nodeEdgeId: string;
}

/**
 * Inputs must already have passed canonical identity/immutable-source validation.
 * These functions use only the caller's transaction. An unexpected row count is
 * fatal: callers must propagate the error so every binding rolls back together.
 * Fixed identifiers and CASE updates work on both SQLite and PostgreSQL. None
 * of these three compatibility models has an @updatedAt column to maintain.
 */
export async function bindCanonicalClaims(
  tx: Prisma.TransactionClient,
  rows: readonly CanonicalClaimBinding[],
): Promise<void> {
  assertDistinctIds(rows);
  for (const chunk of chunks(rows)) {
    const affected = await tx.$executeRaw(Prisma.sql`
      UPDATE "Claim"
      SET "knowledgeNodeId" = CASE "id"
        ${Prisma.join(
          chunk.map((row) => Prisma.sql`WHEN ${row.id} THEN ${row.knowledgeNodeId}`),
          " ",
        )}
        ELSE "knowledgeNodeId" END
      WHERE "id" IN (${Prisma.join(chunk.map((row) => row.id))})
        AND "knowledgeNodeId" IS NULL
    `);
    assertUpdated("claim", affected, chunk.length);
  }
}

export async function bindCanonicalCitations(
  tx: Prisma.TransactionClient,
  rows: readonly CanonicalCitationBinding[],
): Promise<void> {
  assertDistinctIds(rows);
  for (const row of rows) {
    if (
      row.expectedKnowledgeNodeId !== null &&
      row.expectedKnowledgeNodeId !== row.knowledgeNodeId
    ) {
      throw new Error(`Citation '${row.id}' cannot overwrite an existing canonical node binding.`);
    }
    if (row.expectedKnowledgeNodeId === row.knowledgeNodeId && row.expectedWorkId === row.workId) {
      throw new Error(`Citation '${row.id}' already has the requested canonical binding.`);
    }
  }
  for (const chunk of chunks(rows)) {
    const guards = chunk.map((row) => {
      const nodeGuard =
        row.expectedKnowledgeNodeId === null
          ? Prisma.sql`"knowledgeNodeId" IS NULL`
          : Prisma.sql`"knowledgeNodeId" = ${row.expectedKnowledgeNodeId}`;
      const workGuard =
        row.expectedWorkId === null
          ? Prisma.sql`"workId" IS NULL`
          : Prisma.sql`"workId" = ${row.expectedWorkId}`;
      return Prisma.sql`("id" = ${row.id} AND ${nodeGuard} AND ${workGuard})`;
    });
    const affected = await tx.$executeRaw(Prisma.sql`
      UPDATE "Citation"
      SET "knowledgeNodeId" = CASE "id"
        ${Prisma.join(
          chunk.map((row) => Prisma.sql`WHEN ${row.id} THEN ${row.knowledgeNodeId}`),
          " ",
        )}
        ELSE "knowledgeNodeId" END,
        "workId" = CASE "id"
        ${Prisma.join(
          chunk.map((row) => Prisma.sql`WHEN ${row.id} THEN ${row.workId}`),
          " ",
        )}
        ELSE "workId" END
      WHERE ${Prisma.join(guards, " OR ")}
    `);
    assertUpdated("citation", affected, chunk.length);
  }
}

export async function bindCanonicalEvidenceRelations(
  tx: Prisma.TransactionClient,
  rows: readonly CanonicalEvidenceRelationBinding[],
): Promise<void> {
  assertDistinctIds(rows);
  for (const chunk of chunks(rows)) {
    const affected = await tx.$executeRaw(Prisma.sql`
      UPDATE "ClaimEvidenceRelation"
      SET "nodeEdgeId" = CASE "id"
        ${Prisma.join(
          chunk.map((row) => Prisma.sql`WHEN ${row.id} THEN ${row.nodeEdgeId}`),
          " ",
        )}
        ELSE "nodeEdgeId" END
      WHERE "id" IN (${Prisma.join(chunk.map((row) => row.id))})
        AND "nodeEdgeId" IS NULL
    `);
    assertUpdated("claim-evidence relation", affected, chunk.length);
  }
}

function* chunks<T>(rows: readonly T[]): Generator<readonly T[]> {
  for (let index = 0; index < rows.length; index += 40) {
    yield rows.slice(index, index + 40);
  }
}

function assertDistinctIds(rows: readonly { id: string }[]): void {
  if (new Set(rows.map((row) => row.id)).size !== rows.length) {
    throw new Error("Canonical batch bindings contain duplicate row IDs.");
  }
}

function assertUpdated(label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(
      `Canonical ${label} bindings changed during materialization: expected ${expected} rows, updated ${actual}.`,
    );
  }
}
