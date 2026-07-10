import {
  type InspectionReport,
  type RepoFile,
  type RepoRef,
  type RepoRelease,
} from "@oratlas/contracts";
import { parseGithubRepoUrl } from "./url.js";
import { createFetchTransport, type GithubTransport } from "./transport.js";

export const INSPECTOR_VERSION = "github-inspector-0.1.0";

export interface InspectionLimits {
  maxFileBytes: number;
  maxTotalBytes: number;
  maxFileCount: number;
  maxTreeEntries: number;
}

export const DEFAULT_LIMITS: InspectionLimits = {
  maxFileBytes: 512 * 1024, // 512 KiB per file
  maxTotalBytes: 3 * 1024 * 1024, // 3 MiB total fetched content
  maxFileCount: 24, // well-known files fetched with content
  maxTreeEntries: 5000, // directory traversal bound
};

/**
 * Well-known files whose content we fetch (in priority-ish order). Bibliography
 * and knowledge artifacts are discovered dynamically from the tree.
 */
const WELL_KNOWN_FILES = [
  "review-manifest.json",
  "CITATION.cff",
  ".zenodo.json",
  "codemeta.json",
  "myst.yml",
  "myst.yaml",
  "_config.yml",
  "package.json",
  "pyproject.toml",
  "README.md",
  "readme.md",
  "provenance.json",
  "provenance/provenance.json",
];

const PERMITTED_EXTENSIONS = new Set([
  ".json",
  ".jsonl",
  ".cff",
  ".yml",
  ".yaml",
  ".md",
  ".bib",
  ".toml",
  ".txt",
]);

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot).toLowerCase();
}

function b64decode(content: string): string {
  return Buffer.from(content, "base64").toString("utf-8");
}

export interface InspectOptions {
  transport?: GithubTransport;
  token?: string;
  limits?: Partial<InspectionLimits>;
  now?: () => Date;
}

/**
 * Bounded, server-side inspection of a public GitHub repository (spec §6).
 * Never clones; never executes repository code; enforces timeouts and size
 * caps; emits partial-inspection warnings rather than failing hard.
 */
export async function inspectRepository(
  input: string | RepoRef,
  options: InspectOptions = {},
): Promise<InspectionReport> {
  const now = options.now ?? (() => new Date());
  const limits: InspectionLimits = { ...DEFAULT_LIMITS, ...options.limits };

  let ref: RepoRef;
  if (typeof input === "string") {
    const parsed = parseGithubRepoUrl(input);
    if (!parsed.ok) {
      return failedReport(placeholderRef(input), now, parsed.reason, limits);
    }
    ref = parsed.ref;
  } else {
    ref = input;
  }

  const transport = options.transport ?? createFetchTransport({ token: options.token });
  const warnings: string[] = [];

  // 1. Repository metadata
  const repoRes = await transport.request(`/repos/${ref.owner}/${ref.name}`);
  if (repoRes.status === 404) {
    return failedReport(ref, now, "Repository not found or is private.", limits);
  }
  if (repoRes.status === 403) {
    return failedReport(ref, now, "GitHub API access forbidden (rate limit or blocked).", limits);
  }
  if (!repoRes.ok || typeof repoRes.json !== "object" || repoRes.json === null) {
    return failedReport(ref, now, "Failed to fetch repository metadata.", limits);
  }
  const repo = repoRes.json as Record<string, unknown>;
  if (repo.private === true) {
    return failedReport(ref, now, "Private repositories are not supported.", limits);
  }

  const defaultBranch = typeof repo.default_branch === "string" ? repo.default_branch : "main";
  const license =
    repo.license && typeof repo.license === "object"
      ? ((repo.license as Record<string, unknown>).spdx_id as string | null)
      : null;
  const parent =
    repo.parent && typeof repo.parent === "object"
      ? ((repo.parent as Record<string, unknown>).full_name as string | null)
      : null;
  const templateRepo =
    repo.template_repository && typeof repo.template_repository === "object"
      ? ((repo.template_repository as Record<string, unknown>).full_name as string | null)
      : null;

  // 2. Latest commit on the default branch
  let latestCommitSha: string | undefined;
  let latestCommitDate: string | undefined;
  const commitsRes = await transport.request(
    `/repos/${ref.owner}/${ref.name}/commits/${encodeURIComponent(defaultBranch)}`,
  );
  if (commitsRes.ok && commitsRes.json && typeof commitsRes.json === "object") {
    const c = commitsRes.json as Record<string, unknown>;
    if (typeof c.sha === "string") latestCommitSha = c.sha;
    const commit = c.commit as Record<string, unknown> | undefined;
    const committer = commit?.committer as Record<string, unknown> | undefined;
    if (committer && typeof committer.date === "string") latestCommitDate = committer.date;
  } else {
    warnings.push("Could not resolve the latest commit on the default branch.");
  }

  // 3. Tags
  const tags: Array<{ name: string; commitSha: string }> = [];
  const tagsRes = await transport.request(`/repos/${ref.owner}/${ref.name}/tags?per_page=20`);
  if (tagsRes.ok && Array.isArray(tagsRes.json)) {
    for (const t of tagsRes.json as Array<Record<string, unknown>>) {
      const commit = t.commit as Record<string, unknown> | undefined;
      if (typeof t.name === "string" && commit && typeof commit.sha === "string") {
        tags.push({ name: t.name, commitSha: commit.sha });
      }
    }
  }

  // 4. Releases
  const releases: RepoRelease[] = [];
  const relRes = await transport.request(`/repos/${ref.owner}/${ref.name}/releases?per_page=20`);
  if (relRes.ok && Array.isArray(relRes.json)) {
    for (const r of relRes.json as Array<Record<string, unknown>>) {
      const body = typeof r.body === "string" ? r.body : "";
      releases.push({
        tagName: typeof r.tag_name === "string" ? r.tag_name : "",
        name: typeof r.name === "string" ? r.name : null,
        htmlUrl: typeof r.html_url === "string" ? r.html_url : ref.canonicalUrl,
        publishedAt: typeof r.published_at === "string" ? r.published_at : null,
        isDraft: r.draft === true,
        isPrerelease: r.prerelease === true,
        bodyDois: extractDoisFromText(body),
      });
    }
  }

  // 5. Pages URL
  let pagesUrl: string | null = null;
  const pagesRes = await transport.request(`/repos/${ref.owner}/${ref.name}/pages`);
  if (pagesRes.ok && pagesRes.json && typeof pagesRes.json === "object") {
    const p = pagesRes.json as Record<string, unknown>;
    if (typeof p.html_url === "string") pagesUrl = p.html_url;
  }

  // 6. File tree (bounded)
  const tree: Array<{ path: string; size: number }> = [];
  let treeTruncated = false;
  const treeSha = latestCommitSha ?? defaultBranch;
  const treeRes = await transport.request(
    `/repos/${ref.owner}/${ref.name}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
  );
  if (treeRes.ok && treeRes.json && typeof treeRes.json === "object") {
    const t = treeRes.json as Record<string, unknown>;
    if (t.truncated === true) treeTruncated = true;
    if (Array.isArray(t.tree)) {
      for (const entry of t.tree as Array<Record<string, unknown>>) {
        if (entry.type !== "blob") continue;
        if (tree.length >= limits.maxTreeEntries) {
          treeTruncated = true;
          break;
        }
        if (typeof entry.path === "string") {
          tree.push({
            path: entry.path,
            size: typeof entry.size === "number" ? entry.size : 0,
          });
        }
      }
    }
  } else {
    warnings.push("Could not read the repository file tree; extraction will be limited.");
  }

  // 7. Determine which files to fetch: well-known files + discovered artifacts.
  const treePaths = new Set(tree.map((t) => t.path));
  const toFetch = new Set<string>();
  for (const wk of WELL_KNOWN_FILES) {
    if (treePaths.has(wk)) toFetch.add(wk);
  }
  // Discover bibliography, knowledge JSONL, and provenance files from the tree.
  for (const entry of tree) {
    const lower = entry.path.toLowerCase();
    if (lower.endsWith(".bib")) toFetch.add(entry.path);
    if (lower.includes("claim") && lower.endsWith(".jsonl")) toFetch.add(entry.path);
    if (lower.includes("citation") && lower.endsWith(".jsonl")) toFetch.add(entry.path);
    if (lower.includes("relation") && lower.endsWith(".jsonl")) toFetch.add(entry.path);
    if (lower.includes("trust") && lower.endsWith(".jsonl")) toFetch.add(entry.path);
    if (lower.endsWith("provenance.json")) toFetch.add(entry.path);
  }

  const files: Record<string, RepoFile> = {};
  let totalBytesFetched = 0;
  let filesFetched = 0;
  for (const path of toFetch) {
    if (filesFetched >= limits.maxFileCount) {
      warnings.push(`File fetch cap (${limits.maxFileCount}) reached; some files not inspected.`);
      break;
    }
    const ext = extensionOf(path);
    if (ext && !PERMITTED_EXTENSIONS.has(ext) && !path.endsWith("CITATION.cff")) {
      continue;
    }
    const declaredSize = tree.find((t) => t.path === path)?.size ?? 0;
    if (declaredSize > limits.maxFileBytes) {
      warnings.push(`Skipped oversized file '${path}' (${declaredSize} bytes).`);
      files[path] = { path, size: declaredSize, truncated: true };
      continue;
    }
    if (totalBytesFetched + declaredSize > limits.maxTotalBytes) {
      warnings.push(`Total content cap reached before fetching '${path}'.`);
      break;
    }
    const contentRes = await transport.request(
      `/repos/${ref.owner}/${ref.name}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(treeSha)}`,
    );
    if (!contentRes.ok || !contentRes.json || typeof contentRes.json !== "object") {
      warnings.push(`Could not fetch '${path}'.`);
      continue;
    }
    const c = contentRes.json as Record<string, unknown>;
    const size = typeof c.size === "number" ? c.size : declaredSize;
    if (size > limits.maxFileBytes) {
      files[path] = { path, size, truncated: true };
      continue;
    }
    let content: string | undefined;
    if (c.encoding === "base64" && typeof c.content === "string") {
      content = b64decode(c.content.replace(/\n/g, ""));
    } else if (typeof c.content === "string") {
      content = c.content;
    }
    if (content !== undefined) {
      const bytes = Buffer.byteLength(content, "utf-8");
      if (totalBytesFetched + bytes > limits.maxTotalBytes) {
        warnings.push(`Total content cap reached while fetching '${path}'.`);
        break;
      }
      totalBytesFetched += bytes;
      filesFetched += 1;
      files[path] = { path, size, content, truncated: false };
    }
  }

  const rateRemaining = repoRes.headers["x-ratelimit-remaining"];
  if (rateRemaining !== undefined && Number(rateRemaining) < 5) {
    warnings.push(
      "GitHub API rate limit is nearly exhausted; results may be partial. Configure GITHUB_TOKEN for higher limits.",
    );
  }

  const status: InspectionReport["status"] = warnings.length > 0 ? "partial" : "succeeded";

  return {
    schemaVersion: "1.0.0",
    repo: ref,
    inspectedAt: now().toISOString(),
    status,
    githubRepositoryId: typeof repo.id === "number" ? repo.id : undefined,
    description: (repo.description as string | null) ?? null,
    defaultBranch,
    latestCommitSha,
    latestCommitDate,
    licenseSpdx: license ?? null,
    topics: Array.isArray(repo.topics) ? (repo.topics as string[]) : [],
    homepageUrl: (repo.homepage as string | null) ?? null,
    pagesUrl,
    isArchived: repo.archived === true,
    isFork: repo.fork === true,
    parentFullName: parent ?? null,
    isTemplateInstance: Boolean(templateRepo),
    templateFullName: templateRepo ?? null,
    starCount: typeof repo.stargazers_count === "number" ? repo.stargazers_count : undefined,
    createdAt: typeof repo.created_at === "string" ? repo.created_at : undefined,
    pushedAt: typeof repo.pushed_at === "string" ? repo.pushed_at : undefined,
    tags,
    releases,
    tree,
    treeTruncated,
    files,
    warnings,
    limits: {
      maxFileBytes: limits.maxFileBytes,
      maxTotalBytes: limits.maxTotalBytes,
      maxFileCount: limits.maxFileCount,
      totalBytesFetched,
      filesFetched,
    },
  };
}

export function extractDoisFromText(text: string): string[] {
  const out = new Set<string>();
  const re = /10\.\d{4,9}\/[^\s"'<>)\]]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.add(m[0].replace(/[.,;:]+$/, ""));
  }
  return [...out];
}

function placeholderRef(input: string): RepoRef {
  return {
    host: "github.com",
    owner: "unknown",
    name: "unknown",
    canonicalUrl:
      typeof input === "string"
        ? "https://github.com/unknown/unknown"
        : "https://github.com/unknown/unknown",
  };
}

function failedReport(
  ref: RepoRef,
  now: () => Date,
  error: string,
  limits: InspectionLimits,
): InspectionReport {
  return {
    schemaVersion: "1.0.0",
    repo: ref,
    inspectedAt: now().toISOString(),
    status: "failed",
    topics: [],
    tags: [],
    releases: [],
    tree: [],
    treeTruncated: false,
    files: {},
    warnings: [],
    error,
    limits: {
      maxFileBytes: limits.maxFileBytes,
      maxTotalBytes: limits.maxTotalBytes,
      maxFileCount: limits.maxFileCount,
      totalBytesFetched: 0,
      filesFetched: 0,
    },
  };
}
