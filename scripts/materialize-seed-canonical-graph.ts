import { getPrisma } from "@oratlas/db";
import { materializeCanonicalReviewGraph } from "../apps/web/src/lib/canonical-graph-materialization.js";

const prisma = getPrisma();

async function main(): Promise<void> {
  const versions = await prisma.reviewVersion.findMany({
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const { id } of versions) {
    await prisma.$transaction((tx) => materializeCanonicalReviewGraph(tx, id), {
      isolationLevel: "Serializable",
      timeout: 30_000,
    });
  }
  process.stdout.write(
    `  · materialized ${versions.length} seeded review version(s) in the canonical graph\n`,
  );
}

void main()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Unknown seed graph materialization failure."}\n`,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
