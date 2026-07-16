import { scanAcceptedSyntheses } from "../apps/web/src/lib/synthesis-staleness.js";
import { prisma } from "../apps/web/src/lib/db.js";

async function main(): Promise<void> {
  try {
    const pages = [];
    let cursor: string | undefined;
    do {
      const page = await scanAcceptedSyntheses({ client: prisma, cursor, limit: 100 });
      pages.push(page);
      cursor = page.nextCursor;
    } while (cursor);
    process.stdout.write(
      `${JSON.stringify({
        scanned: pages.reduce((sum, page) => sum + page.scanned, 0),
        succeeded: pages.reduce((sum, page) => sum + page.succeeded, 0),
        failed: pages.reduce((sum, page) => sum + page.failed, 0),
        results: pages.flatMap((page) => page.results),
        failures: pages.flatMap((page) => page.failures),
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
