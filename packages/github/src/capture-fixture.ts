import { createHash } from "node:crypto";
import { canonicalJson, type InspectionReport } from "@oratlas/contracts";
import { createFakeTransport, type FakeRepoFixture } from "./testing.js";

export interface CapturedRepositoryFixture {
  schemaVersion: "1.0.0";
  inspectionStatus: "succeeded" | "partial";
  warnings: string[];
  repository: {
    owner: string;
    name: string;
    canonicalUrl: string;
    githubRepositoryId: string;
    defaultBranch: string;
  };
  source: NonNullable<InspectionReport["selectedSource"]>;
  pin: { kind: "commit" | "tag" | "release"; value: string };
  tree: Array<{ path: string; size: number; blobSha?: string }>;
  treeTruncated: boolean;
  files: Record<string, { size: number; truncated: boolean; sha256: string; content: string }>;
  limits: InspectionReport["limits"];
  manifestSha256: string;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function fileManifest(
  files: CapturedRepositoryFixture["files"],
): Array<{ path: string; size: number; truncated: boolean; sha256: string }> {
  return Object.entries(files)
    .map(([path, file]) => ({
      path,
      size: file.size,
      truncated: file.truncated,
      sha256: file.sha256,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function manifestCore(fixture: Omit<CapturedRepositoryFixture, "manifestSha256">) {
  return {
    schemaVersion: fixture.schemaVersion,
    inspectionStatus: fixture.inspectionStatus,
    warnings: fixture.warnings,
    repository: fixture.repository,
    pin: fixture.pin,
    source: fixture.source,
    tree: fixture.tree,
    treeTruncated: fixture.treeTruncated,
    files: fileManifest(fixture.files),
    limits: fixture.limits,
  };
}

/** Convert one successful bounded inspection into stable, timestamp-free fixture bytes. */
export function capturedFixtureFromInspection(
  report: InspectionReport,
  pin: CapturedRepositoryFixture["pin"] = {
    kind:
      report.selectedSource?.kind === "release"
        ? "release"
        : report.selectedSource?.kind === "tag"
          ? "tag"
          : "commit",
    value: report.selectedSource?.releaseTag ?? report.selectedSource?.commitSha ?? "",
  },
): CapturedRepositoryFixture {
  if (report.status === "failed" || !report.selectedSource || !report.githubRepositoryId) {
    throw new Error("Fixture capture requires an immutable public-repository inspection.");
  }
  const files = Object.fromEntries(
    Object.entries(report.files)
      .filter(
        (entry): entry is [string, (typeof entry)[1] & { content: string }] =>
          typeof entry[1].content === "string",
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, file]) => [
        path,
        {
          size: Buffer.byteLength(file.content, "utf8"),
          truncated: file.truncated,
          sha256: sha256(file.content),
          content: file.content,
        },
      ]),
  );
  const fixture = {
    schemaVersion: "1.0.0" as const,
    inspectionStatus: report.status,
    warnings: [...report.warnings],
    repository: {
      owner: report.repo.owner,
      name: report.repo.name,
      canonicalUrl: report.repo.canonicalUrl,
      githubRepositoryId: report.githubRepositoryId,
      defaultBranch: report.defaultBranch ?? "main",
    },
    pin,
    source: report.selectedSource,
    tree: report.tree
      .map((entry) => ({
        ...entry,
        ...(files[entry.path] ? { blobSha: gitBlobSha(files[entry.path]!.content) } : {}),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    treeTruncated: report.treeTruncated,
    files,
    limits: report.limits,
    manifestSha256: "",
  };
  const { manifestSha256: _placeholder, ...coreFixture } = fixture;
  return {
    ...fixture,
    manifestSha256: sha256(canonicalJson(manifestCore(coreFixture))),
  };
}

export function verifyCapturedFixture(fixture: CapturedRepositoryFixture): void {
  for (const [path, file] of Object.entries(fixture.files)) {
    if (
      Buffer.byteLength(file.content, "utf8") !== file.size ||
      sha256(file.content) !== file.sha256
    ) {
      throw new Error(`Captured fixture file integrity failed for '${path}'.`);
    }
  }
  const { manifestSha256, ...coreFixture } = fixture;
  if (sha256(canonicalJson(manifestCore(coreFixture))) !== manifestSha256) {
    throw new Error("Captured fixture manifest integrity failed.");
  }
}

/** Rehydrate the standard in-memory inspector transport; CI never needs live GitHub access. */
export function createCapturedFixtureTransport(fixture: CapturedRepositoryFixture) {
  verifyCapturedFixture(fixture);
  const source = fixture.source;
  const tag = source.releaseTag;
  const fake: FakeRepoFixture = {
    owner: fixture.repository.owner,
    name: fixture.repository.name,
    commitSha: source.commitSha,
    treeSha: source.treeSha,
    repo: {
      id: Number(fixture.repository.githubRepositoryId),
      name: fixture.repository.name,
      owner: { login: fixture.repository.owner },
      html_url: fixture.repository.canonicalUrl,
      private: false,
      default_branch: fixture.repository.defaultBranch,
    },
    files: Object.fromEntries(
      Object.entries(fixture.files).map(([path, file]) => [path, file.content]),
    ),
    treeEntries: fixture.tree.map((entry) => ({
      path: entry.path,
      size: entry.size,
      sha: entry.blobSha,
    })),
    tags: tag
      ? [{ name: tag, commitSha: source.commitSha, tagObjectSha: source.tagObjectSha }]
      : [],
    tagObjects: source.tagObjectSha
      ? { [source.tagObjectSha]: { type: "commit", sha: source.commitSha } }
      : undefined,
    releases:
      source.kind === "release" && tag
        ? [
            {
              tag_name: tag,
              name: tag,
              html_url:
                source.releaseUrl ?? `${fixture.repository.canonicalUrl}/releases/tag/${tag}`,
              published_at: source.sourceCreatedAt ?? null,
              draft: false,
              prerelease: false,
              body: "",
            },
          ]
        : [],
  };
  return createFakeTransport(fake);
}

/** Deterministic on-disk payloads emitted by the maintainer capture CLI. */
export function capturedFixtureOutputFiles(
  fixture: CapturedRepositoryFixture,
): Record<"fixture.json" | "hashes.json" | "transport.ts", string> {
  verifyCapturedFixture(fixture);
  return {
    "fixture.json": `${canonicalJson(fixture)}\n`,
    "hashes.json": `${canonicalJson({
      schemaVersion: "1.0.0",
      manifestSha256: fixture.manifestSha256,
      files: Object.fromEntries(
        Object.entries(fixture.files).map(([path, file]) => [path, file.sha256]),
      ),
    })}\n`,
    "transport.ts": [
      'import fixtureJson from "./fixture.json" with { type: "json" };',
      'import { createCapturedFixtureTransport, type CapturedRepositoryFixture } from "@oratlas/github";',
      "",
      "export const transport = createCapturedFixtureTransport(",
      "  fixtureJson as CapturedRepositoryFixture,",
      ");",
      "",
    ].join("\n"),
  };
}
