import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

export function notesForVersion(changelog: string, version: string): string {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version '${version}'.`);
  }
  const headingPrefix = `## [${version}] - `;
  const heading = changelog
    .split(/\r?\n/)
    .find(
      (line) =>
        line.startsWith(headingPrefix) && /^## \[[0-9A-Za-z.-]+\] - \d{4}-\d{2}-\d{2}$/.test(line),
    );
  if (!heading) throw new Error(`CHANGELOG.md has no dated [${version}] section.`);
  const start = changelog.indexOf(heading);
  const boundaries = ["\n## [", "\n[Unreleased]:"]
    .map((marker) => changelog.indexOf(marker, start + heading.length))
    .filter((index) => index !== -1);
  const next = boundaries.length > 0 ? Math.min(...boundaries) : -1;
  return changelog.slice(start, next === -1 ? changelog.length : next).trim() + "\n";
}

export function validateReleaseTag(tag: string, version: string): void {
  if (tag !== `v${version}`) {
    throw new Error(`Tag '${tag}' does not match root package version '${version}'.`);
  }
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1]?.endsWith("release-notes.ts")) {
  const root = resolve(import.meta.dirname, "..");
  const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
    version: string;
  };
  const tag = argument("--tag") ?? process.env.GITHUB_REF_NAME;
  if (!tag) throw new Error("Pass --tag or set GITHUB_REF_NAME.");
  validateReleaseTag(tag, packageJson.version);
  process.stdout.write(
    notesForVersion(readFileSync(resolve(root, "CHANGELOG.md"), "utf8"), packageJson.version),
  );
}
