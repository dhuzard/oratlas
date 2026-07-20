import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  capturedFixtureFromInspection,
  capturedFixtureOutputFiles,
  createFetchTransport,
  inspectRepository,
  type GithubTransport,
} from "@oratlas/github";

interface Options {
  repo: string;
  out: string;
  pin: { kind: "commit" | "tag" | "release"; value: string };
}

function usage(): never {
  throw new Error(
    "Usage: capture-github-fixture --repo owner/name (--commit SHA | --tag TAG | --release TAG) --out DIRECTORY",
  );
}

function options(argv: string[]): Options {
  const value = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const repo = value("--repo");
  const out = value("--out");
  const pins = [
    ["commit", value("--commit")],
    ["tag", value("--tag")],
    ["release", value("--release")],
  ].filter((entry): entry is [Options["pin"]["kind"], string] => Boolean(entry[1]));
  if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !out || pins.length !== 1) {
    return usage();
  }
  if (pins[0]![0] === "commit" && !/^[0-9a-f]{40}$/i.test(pins[0]![1])) return usage();
  return { repo, out, pin: { kind: pins[0]![0], value: pins[0]![1] } };
}

async function main(): Promise<void> {
  const input = options(process.argv.slice(2));
  const [owner, name] = input.repo.split("/") as [string, string];
  const live = createFetchTransport({ token: process.env.GITHUB_TOKEN });
  const transport =
    input.pin.kind === "commit" ? exactCommitTransport(live, owner, name, input.pin.value) : live;
  const source =
    input.pin.kind === "tag" || input.pin.kind === "release"
      ? { kind: input.pin.kind, tag: input.pin.value }
      : { kind: "default-branch" as const };
  const report = await inspectRepository(`https://github.com/${input.repo}`, {
    transport,
    source,
    now: () => new Date(0),
  });
  if (report.status === "failed" || !report.selectedSource) {
    throw new Error(report.error ?? "GitHub fixture inspection failed.");
  }
  if (
    report.selectedSource.commitSha.toLowerCase() !==
    (input.pin.kind === "commit"
      ? input.pin.value.toLowerCase()
      : report.selectedSource.commitSha.toLowerCase())
  ) {
    throw new Error("GitHub resolved a different commit than the requested exact pin.");
  }
  const fixture = capturedFixtureFromInspection(report, input.pin);
  const directory = resolve(input.out);
  await mkdir(directory, { recursive: true });
  const outputs = capturedFixtureOutputFiles(fixture);
  await Promise.all(
    Object.entries(outputs).map(([name, content]) =>
      writeFile(resolve(directory, name), content, "utf8"),
    ),
  );
  process.stdout.write(
    `Captured ${Object.keys(fixture.files).length} bounded files at ${fixture.source.commitSha}.\n`,
  );
}

function exactCommitTransport(
  live: GithubTransport,
  owner: string,
  name: string,
  commitSha: string,
): GithubTransport {
  let branchCommitRequestRewritten = false;
  const prefix = `/repos/${owner}/${name}/commits/`;
  return {
    request(path, init) {
      if (!branchCommitRequestRewritten && path.startsWith(prefix)) {
        branchCommitRequestRewritten = true;
        return live.request(`${prefix}${commitSha}`, init);
      }
      return live.request(path, init);
    },
  };
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
