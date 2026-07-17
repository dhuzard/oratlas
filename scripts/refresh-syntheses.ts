import { scanAcceptedSyntheses } from "../apps/web/src/lib/synthesis-staleness.js";
import { prisma } from "../apps/web/src/lib/db.js";

async function main(): Promise<void> {
  try {
    let scanned = 0;
    let succeeded = 0;
    let failed = 0;
    const results: Awaited<ReturnType<typeof scanAcceptedSyntheses>>["results"] = [];
    const failures: Awaited<ReturnType<typeof scanAcceptedSyntheses>>["failures"] = [];
    let cursor: string | undefined;
    do {
      const page = await scanAcceptedSyntheses({ client: prisma, cursor, limit: 100 });
      scanned += page.scanned;
      succeeded += page.succeeded;
      failed += page.failed;
      results.push(...page.results);
      failures.push(...page.failures);
      cursor = page.nextCursor;
    } while (cursor);
    process.stdout.write(
      `${JSON.stringify({
        scanned,
        succeeded,
        failed,
        results,
        failures,
      })}\n`,
    );
  } catch {
    process.stderr.write("Synthesis freshness scan failed.\n");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
