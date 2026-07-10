/**
 * CLI: inspect a public GitHub repository and print the extraction result
 * (metadata + compatibility + knowledge counts). Read-only; does not write to
 * the database. Uses GITHUB_TOKEN when present for higher rate limits.
 *
 * Usage: pnpm ingest https://github.com/owner/repository
 */
import { SynchronousIngestionRunner } from "@oratlas/github";
import { runExtraction } from "@oratlas/extractor";

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: pnpm ingest <github-repo-url>");
    process.exit(1);
  }
  const runner = new SynchronousIngestionRunner({ token: process.env.GITHUB_TOKEN || undefined });
  const report = await runner.run(url);
  if (report.status === "failed") {
    console.error(`Inspection failed: ${report.error}`);
    process.exit(2);
  }
  const extraction = runExtraction(report);
  console.info(
    JSON.stringify(
      {
        repo: report.repo,
        inspectionStatus: report.status,
        warnings: report.warnings,
        compatibility: extraction.compatibility.overallCompatibility,
        levelRationale: extraction.compatibility.levelRationale,
        recommendations: extraction.compatibility.recommendations,
        title: extraction.metadata.fields.title?.value,
        versionDoi: extraction.metadata.fields.versionDoi?.value,
        conceptDoi: extraction.metadata.fields.conceptDoi?.value,
        knowledgeCounts: {
          claims: extraction.knowledge.claims.length,
          citations: extraction.knowledge.citations.length,
          relations: extraction.knowledge.relations.length,
          trust: extraction.knowledge.trust.length,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
