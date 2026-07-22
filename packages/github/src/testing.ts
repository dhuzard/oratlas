import { createHash } from "node:crypto";
import { type GithubResponse, type GithubTransport } from "./transport.js";

export interface FakeRepoFixture {
  owner: string;
  name: string;
  repo: Record<string, unknown>;
  commitSha?: string;
  treeSha?: string;
  tags?: Array<{
    name: string;
    commitSha: string;
    /** Optional current ref target when the list endpoint was stale or the tag moved. */
    refCommitSha?: string;
    tagObjectSha?: string;
  }>;
  /** Annotated tag object sha -> its immediate target. */
  tagObjects?: Record<string, { type: "tag" | "commit"; sha: string }>;
  releases?: Array<Record<string, unknown>>;
  pages?: Record<string, unknown> | null;
  /** repository-relative path -> file content (utf-8). */
  files?: Record<string, string>;
  /** extra tree entries (paths) with no fetched content. */
  extraTreePaths?: string[];
  /** Exact captured tree metadata; preferred over synthesized file entries. */
  treeEntries?: Array<{ path: string; size: number; sha?: string }>;
  /** Optional request trace used to assert exact commit/tree endpoint selection. */
  requestLog?: string[];
  /** Simulate GitHub's Contents API omitting inline content above this size. */
  contentsInlineLimitBytes?: number;
}

function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function ok(json: unknown, headers: Record<string, string> = {}): GithubResponse {
  return { status: 200, ok: true, json, headers };
}
function notFound(): GithubResponse {
  return { status: 404, ok: false, json: { message: "Not Found" }, headers: {} };
}

/**
 * In-memory GitHub transport for tests: routes REST paths to a fixture so the
 * suite never touches the network (spec §21).
 */
export function createFakeTransport(fixture: FakeRepoFixture): GithubTransport {
  const inputBase = `/repos/${fixture.owner}/${fixture.name}`;
  const repoOwner = fixture.repo.owner as Record<string, unknown> | undefined;
  const resolvedOwner = typeof repoOwner?.login === "string" ? repoOwner.login : fixture.owner;
  const resolvedName = typeof fixture.repo.name === "string" ? fixture.repo.name : fixture.name;
  const resolvedBase = `/repos/${resolvedOwner}/${resolvedName}`;
  const commitSha = fixture.commitSha ?? "a".repeat(40);
  const treeSha = fixture.treeSha ?? "f".repeat(40);
  const files = fixture.files ?? {};
  const treePaths = new Set<string>([...Object.keys(files), ...(fixture.extraTreePaths ?? [])]);

  return {
    async request(path: string): Promise<GithubResponse> {
      fixture.requestLog?.push(path);
      const pathname = path.split("?")[0] ?? path;
      const base =
        pathname === resolvedBase || pathname.startsWith(`${resolvedBase}/`)
          ? resolvedBase
          : inputBase;
      if (pathname === base)
        return ok({ ...fixture.repo, default_branch: fixture.repo.default_branch ?? "main" });
      if (pathname.startsWith(`${base}/commits/`)) {
        const requested = decodeURIComponent(pathname.slice(`${base}/commits/`.length));
        const sha = requested === (fixture.repo.default_branch ?? "main") ? commitSha : requested;
        return ok({ sha, commit: { committer: { date: "2026-06-01T00:00:00Z" } } });
      }
      if (pathname.startsWith(`${base}/git/commits/`)) {
        const requested = decodeURIComponent(pathname.slice(`${base}/git/commits/`.length));
        return ok({ sha: requested, tree: { sha: treeSha } });
      }
      if (pathname === `${base}/tags`) {
        return ok(
          (fixture.tags ?? []).map((t) => ({ name: t.name, commit: { sha: t.commitSha } })),
        );
      }
      if (pathname === `${base}/releases`) {
        return ok(fixture.releases ?? []);
      }
      if (pathname.startsWith(`${base}/releases/tags/`)) {
        const name = decodeURIComponent(pathname.slice(`${base}/releases/tags/`.length));
        const release = fixture.releases?.find((candidate) => candidate.tag_name === name);
        return release ? ok(release) : notFound();
      }
      if (pathname.startsWith(`${base}/git/ref/tags/`)) {
        const name = decodeURIComponent(pathname.slice(`${base}/git/ref/tags/`.length));
        const tag = fixture.tags?.find((candidate) => candidate.name === name);
        if (!tag) return notFound();
        return ok({
          ref: `refs/tags/${name}`,
          object: tag.tagObjectSha
            ? { type: "tag", sha: tag.tagObjectSha }
            : { type: "commit", sha: tag.refCommitSha ?? tag.commitSha },
        });
      }
      if (pathname.startsWith(`${base}/git/tags/`)) {
        const sha = decodeURIComponent(pathname.slice(`${base}/git/tags/`.length));
        const target = fixture.tagObjects?.[sha];
        return target ? ok({ object: target }) : notFound();
      }
      if (pathname === `${base}/pages`) {
        return fixture.pages ? ok(fixture.pages) : notFound();
      }
      if (pathname.startsWith(`${base}/git/trees/`)) {
        return ok({
          truncated: false,
          tree: fixture.treeEntries
            ? fixture.treeEntries.map((entry) => ({
                path: entry.path,
                type: "blob",
                size: entry.size,
                sha: entry.sha ?? gitBlobSha(files[entry.path] ?? ""),
              }))
            : [...treePaths].map((p) => ({
                path: p,
                type: "blob",
                size: Buffer.byteLength(files[p] ?? "", "utf-8"),
                sha: gitBlobSha(files[p] ?? ""),
              })),
        });
      }
      if (pathname.startsWith(`${base}/git/blobs/`)) {
        const sha = decodeURIComponent(pathname.slice(`${base}/git/blobs/`.length));
        const content = Object.values(files).find((candidate) => gitBlobSha(candidate) === sha);
        if (content === undefined) return notFound();
        return ok({
          size: Buffer.byteLength(content, "utf-8"),
          encoding: "base64",
          content: Buffer.from(content, "utf-8").toString("base64"),
        });
      }
      if (pathname.startsWith(`${base}/contents/`)) {
        const rel = decodeURIComponent(pathname.slice(`${base}/contents/`.length));
        const content = files[rel];
        if (content === undefined) return notFound();
        const size = Buffer.byteLength(content, "utf-8");
        if (
          fixture.contentsInlineLimitBytes !== undefined &&
          size > fixture.contentsInlineLimitBytes
        ) {
          return ok({ size, encoding: "none", content: "" });
        }
        return ok({
          size,
          encoding: "base64",
          content: Buffer.from(content, "utf-8").toString("base64"),
        });
      }
      return notFound();
    },
  };
}
