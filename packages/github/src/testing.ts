import { type GithubResponse, type GithubTransport } from "./transport.js";

export interface FakeRepoFixture {
  owner: string;
  name: string;
  repo: Record<string, unknown>;
  commitSha?: string;
  tags?: Array<{ name: string; commitSha: string }>;
  releases?: Array<Record<string, unknown>>;
  pages?: Record<string, unknown> | null;
  /** repository-relative path -> file content (utf-8). */
  files?: Record<string, string>;
  /** extra tree entries (paths) with no fetched content. */
  extraTreePaths?: string[];
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
  const base = `/repos/${fixture.owner}/${fixture.name}`;
  const commitSha = fixture.commitSha ?? "a".repeat(40);
  const files = fixture.files ?? {};
  const treePaths = new Set<string>([...Object.keys(files), ...(fixture.extraTreePaths ?? [])]);

  return {
    async request(path: string): Promise<GithubResponse> {
      const pathname = path.split("?")[0] ?? path;
      if (pathname === base)
        return ok({ ...fixture.repo, default_branch: fixture.repo.default_branch ?? "main" });
      if (pathname === `${base}/commits/${fixture.repo.default_branch ?? "main"}`) {
        return ok({ sha: commitSha, commit: { committer: { date: "2026-06-01T00:00:00Z" } } });
      }
      if (pathname === `${base}/tags`) {
        return ok(
          (fixture.tags ?? []).map((t) => ({ name: t.name, commit: { sha: t.commitSha } })),
        );
      }
      if (pathname === `${base}/releases`) {
        return ok(fixture.releases ?? []);
      }
      if (pathname === `${base}/pages`) {
        return fixture.pages ? ok(fixture.pages) : notFound();
      }
      if (pathname.startsWith(`${base}/git/trees/`)) {
        return ok({
          truncated: false,
          tree: [...treePaths].map((p) => ({
            path: p,
            type: "blob",
            size: Buffer.byteLength(files[p] ?? "", "utf-8"),
          })),
        });
      }
      if (pathname.startsWith(`${base}/contents/`)) {
        const rel = decodeURIComponent(pathname.slice(`${base}/contents/`.length));
        const content = files[rel];
        if (content === undefined) return notFound();
        return ok({
          size: Buffer.byteLength(content, "utf-8"),
          encoding: "base64",
          content: Buffer.from(content, "utf-8").toString("base64"),
        });
      }
      return notFound();
    },
  };
}
