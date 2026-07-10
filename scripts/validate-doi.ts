/**
 * CLI: validate a DOI and print the structured report.
 * Usage: pnpm validate-doi 10.5281/zenodo.1234567 [--repo https://github.com/o/r]
 * Reserved example DOIs (10.5555/*) are never resolved outward.
 */
import { validateDoi } from "@oratlas/zenodo";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const doi = args.find((a) => !a.startsWith("--"));
  if (!doi) {
    console.error("Usage: pnpm validate-doi <doi> [--repo <url>] [--title <title>]");
    process.exit(1);
  }
  const repoIdx = args.indexOf("--repo");
  const titleIdx = args.indexOf("--title");
  const repositoryUrl = repoIdx >= 0 ? args[repoIdx + 1] : undefined;
  const title = titleIdx >= 0 ? args[titleIdx + 1] : undefined;

  const report = await validateDoi({ doi, repositoryUrl, title });
  console.info(JSON.stringify(report, null, 2));
  if (report.status === "invalid" || report.status === "unresolvable") {
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
