import { afterAll, describe, expect, it } from "vitest";
import {
  applyDatabaseGuards,
  DATABASE_GUARD_NAMES,
  getPrisma,
  POSTGRES_DATABASE_GUARD_TRIGGER_NAMES,
} from "./index.js";

const enabled = Boolean(process.env.DATABASE_GUARD_TEST_DATABASE_URL);
const prisma = getPrisma();

describe.skipIf(!enabled)("PostgreSQL database guards", () => {
  afterAll(async () => prisma.$disconnect());

  it("installs every constraint and trigger and rejects invalid direct writes", async () => {
    await applyDatabaseGuards(prisma, "postgresql");
    const constraints = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
    `;
    expect(constraints.map(({ conname }) => conname)).toEqual(
      expect.arrayContaining([...DATABASE_GUARD_NAMES]),
    );
    const triggers = await prisma.$queryRaw<Array<{ tgname: string }>>`
      SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
    `;
    expect(triggers.map(({ tgname }) => tgname)).toEqual(
      expect.arrayContaining([...POSTGRES_DATABASE_GUARD_TRIGGER_NAMES]),
    );

    await expect(
      prisma.review.create({
        data: {
          slug: `invalid-synthesis-${Date.now()}`,
          title: "Invalid synthesis",
          reviewType: "ai-synthesis",
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.synthesisGenerationRequestClaim.create({
        data: {
          key: `invalid-claim-${Date.now()}`,
          requestKey: `invalid-request-${Date.now()}`,
          selectorJson: "{}",
          selectorHash: "a".repeat(64),
          status: "running",
        },
      }),
    ).rejects.toThrow();
  });
});
