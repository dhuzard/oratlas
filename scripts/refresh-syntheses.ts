import { scanAcceptedSyntheses } from "../apps/web/src/lib/synthesis-staleness.js";
import { prisma } from "../apps/web/src/lib/db.js";

async function main(): Promise<void> {
  try {
    const result = await scanAcceptedSyntheses({ client: prisma });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write("Synthesis freshness scan failed.\n");
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
