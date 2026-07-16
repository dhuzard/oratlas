import {
  MAX_NODE_MANIFEST_BYTES,
  type InspectionReport,
  type NodeManifest,
  type NodeManifestSource,
  type RepoFile,
  type RepoRef,
  type RepoRelease,
  type RepoSourceSelection,
  validateReviewManifest,
  validateNodeManifest,
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
  maxFileBytes: 2 * 1024 * 1024, // 2 MiB per file
  maxTotalBytes: 6 * 1024 * 1024, // 6 MiB total fetched content
  maxFileCount: 24, // well-known files fetched with content
  maxTreeEntries: 5000, // directory traversal bound
};

/**
 * Well-known files whose content we fetch (in priority-ish order). Bibliography
 * and knowledge artifacts are discovered dynamically from the tree.
 */
const WELL_KNOWN_FILES = [
  "review-manifest.json",
  "node-manifest.json",
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
  /** Explicit source choice; defaults to a deliberately selected repository-only capture. */
  source?: RepoSourceSelection;
  /** @deprecated Compatibility for callers predating explicit tag/release selection. */
  releaseTag?: string;
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

  const resolvedOwner =
    repo.owner && typeof repo.owner === "object"
      ? (repo.owner as Record<string, unknown>).login
      : undefined;
  const resolvedName = typeof repo.name === "string" ? repo.name : undefined;
  const resolvedUrl = typeof repo.html_url === "string" ? repo.html_url : undefined;
  if (
    typeof resolvedOwner === "string" &&
    typeof resolvedName === "string" &&
    typeof resolvedUrl === "string"
  ) {
    ref = {
      host: "github.com",
      owner: resolvedOwner,
      name: resolvedName,
      canonicalUrl: resolvedUrl.replace(/\.git$/i, "").replace(/\/+$/, ""),
    };
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
  const tagsRes = await transport.request(`/repos/${ref.owner}/${ref.name}/tags?per_page=100`);
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
  const relRes = await transport.request(`/repos/${ref.owner}/${ref.name}/releases?per_page=100`);
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

  // 5. Resolve the exact source. A requested tag is dereferenced through Git
  // tag objects until a commit is reached (annotated and lightweight tags are
  // both supported). Failure never falls back to a mutable default branch.
  const sourceSelection: RepoSourceSelection =
    options.source ??
    (options.releaseTag !== undefined
      ? { kind: "release", tag: options.releaseTag }
      : { kind: "default-branch" });
  let selectedCommitSha = latestCommitSha;
  let selectedCommitDate = latestCommitDate;
  let selectedTagObjectSha: string | undefined;
  const requestedTag = sourceSelection.kind === "default-branch" ? undefined : sourceSelection.tag;
  let selectedRelease: RepoRelease | undefined;
  if (requestedTag) {
    if (sourceSelection.kind === "release") {
      const exactRelease = await transport.request(
        `/repos/${ref.owner}/${ref.name}/releases/tags/${encodeURIComponent(requestedTag)}`,
      );
      if (!exactRelease.ok || !exactRelease.json || typeof exactRelease.json !== "object") {
        return failedReport(
          ref,
          now,
          exactRelease.status === 404
            ? `Published release '${requestedTag}' was not found.`
            : `Published release '${requestedTag}' could not be classified by GitHub.`,
          limits,
        );
      }
      const raw = exactRelease.json as Record<string, unknown>;
      if (raw.draft === true || raw.tag_name !== requestedTag) {
        return failedReport(ref, now, `Release '${requestedTag}' is draft or mismatched.`, limits);
      }
      selectedRelease = toRepoRelease(raw, ref);
      if (!releases.some((release) => release.tagName === requestedTag)) {
        releases.push(selectedRelease);
      }
    } else {
      const exactRelease = await transport.request(
        `/repos/${ref.owner}/${ref.name}/releases/tags/${encodeURIComponent(requestedTag)}`,
      );
      if (exactRelease.ok) {
        return failedReport(
          ref,
          now,
          `Tag '${requestedTag}' is a published GitHub release; select it as a release.`,
          limits,
        );
      }
      if (exactRelease.status !== 404) {
        return failedReport(
          ref,
          now,
          `Tag '${requestedTag}' could not be classified against GitHub releases.`,
          limits,
        );
      }
    }
    const resolved = await resolveTagToCommit(transport, ref, requestedTag);
    if (!resolved.ok) return failedReport(ref, now, resolved.error, limits);
    selectedCommitSha = resolved.commitSha;
    selectedTagObjectSha = resolved.tagObjectSha;
    const selectedCommit = await transport.request(
      `/repos/${ref.owner}/${ref.name}/commits/${encodeURIComponent(selectedCommitSha)}`,
    );
    if (selectedCommit.ok && selectedCommit.json && typeof selectedCommit.json === "object") {
      const commit = (selectedCommit.json as Record<string, unknown>).commit as
        Record<string, unknown> | undefined;
      const committer = commit?.committer as Record<string, unknown> | undefined;
      if (typeof committer?.date === "string") selectedCommitDate = committer.date;
    }
  }
  if (!selectedCommitSha) {
    return failedReport(ref, now, "Could not resolve an immutable source commit.", limits);
  }
  const commitObject = await transport.request(
    `/repos/${ref.owner}/${ref.name}/git/commits/${encodeURIComponent(selectedCommitSha)}`,
  );
  const commitJson =
    commitObject.ok && commitObject.json && typeof commitObject.json === "object"
      ? (commitObject.json as Record<string, unknown>)
      : undefined;
  const commitTree = commitJson?.tree as Record<string, unknown> | undefined;
  const selectedTreeSha = normalizeGitOid(commitTree?.sha);
  if (!selectedTreeSha) {
    return failedReport(ref, now, "Could not resolve the selected commit tree.", limits);
  }
  const selectedSource: NonNullable<InspectionReport["selectedSource"]> = requestedTag
    ? {
        kind: sourceSelection.kind,
        commitSha: selectedCommitSha,
        releaseTag: requestedTag,
        releaseUrl: selectedRelease?.htmlUrl,
        tagObjectSha: selectedTagObjectSha,
        treeSha: selectedTreeSha,
        sourceCreatedAt: selectedCommitDate,
      }
    : {
        kind: "default-branch",
        commitSha: selectedCommitSha,
        branch: defaultBranch,
        treeSha: selectedTreeSha,
        sourceCreatedAt: selectedCommitDate,
      };

  // 6. Pages URL
  let pagesUrl: string | null = null;
  const pagesRes = await transport.request(`/repos/${ref.owner}/${ref.name}/pages`);
  if (pagesRes.ok && pagesRes.json && typeof pagesRes.json === "object") {
    const p = pagesRes.json as Record<string, unknown>;
    if (typeof p.html_url === "string") pagesUrl = p.html_url;
  }

  // 7. File tree (bounded) at the exact selected commit.
  const tree: Array<{ path: string; size: number }> = [];
  let treeTruncated = false;
  const treeSha = selectedTreeSha;
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

  // 8. Determine which files to fetch: well-known files + discovered artifacts.
  const treePaths = new Set(tree.map((t) => t.path));
  const wellKnownToFetch = new Set<string>();
  const toFetch = new Set<string>();
  for (const wk of WELL_KNOWN_FILES) {
    if (treePaths.has(wk)) {
      wellKnownToFetch.add(wk);
      toFetch.add(wk);
    }
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
  let fileFetchAttempts = 0;
  let fileFetchCapWarned = false;
  let nodeManifest: NodeManifest | undefined;

  const warnFileFetchCap = (): void => {
    if (fileFetchCapWarned) return;
    fileFetchCapWarned = true;
    warnings.push(`File fetch cap (${limits.maxFileCount}) reached; some files not inspected.`);
  };

  /** Fetch one textual repository file at the selected immutable commit. */
  const fetchFile = async (path: string, maxFileBytes = limits.maxFileBytes): Promise<void> => {
    if (fileFetchAttempts >= limits.maxFileCount) {
      warnFileFetchCap();
      return;
    }
    const ext = extensionOf(path);
    if (ext && !PERMITTED_EXTENSIONS.has(ext) && !path.endsWith("CITATION.cff")) {
      return;
    }
    const declaredSize = tree.find((t) => t.path === path)?.size ?? 0;
    if (declaredSize > maxFileBytes) {
      warnings.push(`Skipped oversized file '${path}' (${declaredSize} bytes).`);
      files[path] = { path, size: declaredSize, truncated: true };
      return;
    }
    if (totalBytesFetched + declaredSize > limits.maxTotalBytes) {
      warnings.push(`Total content cap reached before fetching '${path}'.`);
      return;
    }
    if (!treePaths.has(path)) {
      warnings.push(`Declared file '${path}' does not exist in the selected commit tree.`);
      return;
    }
    fileFetchAttempts += 1;
    const contentRes = await transport.request(
      `/repos/${ref.owner}/${ref.name}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(selectedCommitSha)}`,
    );
    if (!contentRes.ok || !contentRes.json || typeof contentRes.json !== "object") {
      warnings.push(`Could not fetch '${path}'.`);
      return;
    }
    const c = contentRes.json as Record<string, unknown>;
    const size = typeof c.size === "number" ? c.size : declaredSize;
    if (size > maxFileBytes) {
      warnings.push(`Skipped oversized file '${path}' (${size} bytes).`);
      files[path] = { path, size, truncated: true };
      return;
    }
    let content: string | undefined;
    if (c.encoding === "base64" && typeof c.content === "string") {
      content = b64decode(c.content.replace(/\n/g, ""));
    } else if (typeof c.content === "string") {
      content = c.content;
    }
    if (content !== undefined) {
      const bytes = Buffer.byteLength(content, "utf-8");
      if (bytes > maxFileBytes) {
        warnings.push(`Skipped oversized file '${path}' (${bytes} bytes).`);
        files[path] = { path, size: bytes, truncated: true };
        return;
      }
      if (totalBytesFetched + bytes > limits.maxTotalBytes) {
        warnings.push(`Total content cap reached while fetching '${path}'.`);
        files[path] = { path, size: bytes, truncated: true };
        return;
      }
      totalBytesFetched += bytes;
      filesFetched += 1;
      files[path] = { path, size, content, truncated: false };
    }
  };

  const reviewArtifactPaths: string[] = [];
  // A valid review manifest is an explicit safe routing source for legacy
  // knowledge artifacts, including relation-scoped TRUST in mixed node repos.
  if (treePaths.has("review-manifest.json")) {
    await fetchFile("review-manifest.json");
    toFetch.delete("review-manifest.json");
    const reviewManifestFile = files["review-manifest.json"];
    if (reviewManifestFile?.content) {
      try {
        const validation = validateReviewManifest(JSON.parse(reviewManifestFile.content));
        if (validation.ok && validation.manifest?.artifacts) {
          reviewArtifactPaths.push(
            ...Object.values(validation.manifest.artifacts).filter((path): path is string =>
              Boolean(path),
            ),
          );
        }
      } catch {
        warnings.push("Invalid review-manifest.json JSON; declared artifacts were not fetched.");
      }
    }
  }

  // The node manifest is fetched first because it is the only trusted routing input
  // for arbitrarily named node source files. It receives its contract-specific
  // cap while still consuming the shared file-count and total-byte budgets.
  if (treePaths.has("node-manifest.json")) {
    await fetchFile("node-manifest.json", MAX_NODE_MANIFEST_BYTES);
    toFetch.delete("node-manifest.json");
    const manifestFile = files["node-manifest.json"];
    if (manifestFile?.content) {
      try {
        const validation = validateNodeManifest(JSON.parse(manifestFile.content));
        if (validation.ok && validation.manifest) {
          nodeManifest = validation.manifest;
          for (const path of sourcePaths(validation.manifest.nodes)) {
            if (fileFetchAttempts >= limits.maxFileCount) {
              warnFileFetchCap();
              break;
            }
            await fetchFile(path);
            toFetch.delete(path);
          }
          if (validation.manifest.edges) {
            for (const path of sourcePaths(validation.manifest.edges)) {
              if (fileFetchAttempts >= limits.maxFileCount) {
                warnFileFetchCap();
                break;
              }
              await fetchFile(path);
              toFetch.delete(path);
            }
          }
          if (validation.manifest.trustAssessments) {
            const path = validation.manifest.trustAssessments.path;
            if (fileFetchAttempts < limits.maxFileCount) {
              await fetchFile(path);
              toFetch.delete(path);
            } else {
              warnFileFetchCap();
            }
          }
        } else {
          warnings.push(
            `Invalid node-manifest.json; declared node files were not fetched (${validation.errors[0] ?? "schema validation failed"}).`,
          );
        }
      } catch {
        warnings.push("Invalid node-manifest.json JSON; declared node files were not fetched.");
      }
    }
  }

  // Both routing manifests have now consumed their reserved first attempts.
  // Fetch explicitly declared review artifacts only after node sources so a
  // low shared file cap cannot starve first-class node publication.
  for (const path of [...new Set(reviewArtifactPaths)]) {
    if (files[path]) {
      toFetch.delete(path);
      continue;
    }
    if (fileFetchAttempts >= limits.maxFileCount) {
      warnFileFetchCap();
      break;
    }
    await fetchFile(path);
    toFetch.delete(path);
  }

  // A node artifact may match any legacy discovery heuristic. If a declared
  // node source was unavailable or oversized, its artifact paths are unknown,
  // so selectively filtering the generic queue would fail open. Once a valid
  // node manifest exists, retain well-known metadata only; node and edge
  // sources have already been fetched explicitly above. Mixed repositories
  // must use an explicit, safely disambiguated legacy-artifact path in a future
  // phase rather than relying on filename heuristics.
  if (nodeManifest) {
    const ambiguousPaths = [...toFetch].filter((path) => !wellKnownToFetch.has(path));
    for (const path of ambiguousPaths) {
      toFetch.delete(path);
    }
    if (ambiguousPaths.length > 0) {
      warnings.push(
        `Suppressed ${ambiguousPaths.length} generic content path(s) because a valid node manifest requires artifact-safe explicit fetching.`,
      );
    }
  }

  for (const path of toFetch) {
    if (fileFetchAttempts >= limits.maxFileCount) {
      warnFileFetchCap();
      break;
    }
    await fetchFile(path);
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
    githubRepositoryId:
      typeof repo.id === "number" && Number.isSafeInteger(repo.id)
        ? String(repo.id)
        : typeof repo.id === "string" && /^\d+$/.test(repo.id)
          ? repo.id
          : undefined,
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
    selectedSource,
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

function sourcePaths(source: NodeManifestSource): string[] {
  return source.format === "json" ? source.files : [source.path];
}

function toRepoRelease(raw: Record<string, unknown>, ref: RepoRef): RepoRelease {
  return {
    tagName: typeof raw.tag_name === "string" ? raw.tag_name : "",
    name: typeof raw.name === "string" ? raw.name : null,
    htmlUrl: typeof raw.html_url === "string" ? raw.html_url : ref.canonicalUrl,
    publishedAt: typeof raw.published_at === "string" ? raw.published_at : null,
    isDraft: raw.draft === true,
    isPrerelease: raw.prerelease === true,
    bodyDois: extractDoisFromText(typeof raw.body === "string" ? raw.body : ""),
  };
}

type TagResolution =
  { ok: true; commitSha: string; tagObjectSha?: string } | { ok: false; error: string };

async function resolveTagToCommit(
  transport: GithubTransport,
  ref: RepoRef,
  tag: string,
): Promise<TagResolution> {
  if (tag.length > 120) return { ok: false, error: "Release/tag selection is too long." };
  const response = await transport.request(
    `/repos/${ref.owner}/${ref.name}/git/ref/tags/${encodeURIComponent(tag)}`,
  );
  if (!response.ok || !response.json || typeof response.json !== "object") {
    return { ok: false, error: `Release/tag '${tag}' was not found.` };
  }
  let object = (response.json as Record<string, unknown>).object as
    Record<string, unknown> | undefined;
  let tagObjectSha: string | undefined;
  const visited = new Set<string>();
  for (let depth = 0; depth < 8; depth += 1) {
    const type = object?.type;
    const sha = normalizeGitOid(object?.sha);
    if (!sha || (type !== "commit" && type !== "tag")) {
      return { ok: false, error: `Release/tag '${tag}' has an unsupported target.` };
    }
    if (type === "commit") return { ok: true, commitSha: sha, tagObjectSha };
    tagObjectSha ??= sha;
    if (visited.has(sha)) {
      return { ok: false, error: `Release/tag '${tag}' contains a tag cycle.` };
    }
    visited.add(sha);
    const tagResponse = await transport.request(
      `/repos/${ref.owner}/${ref.name}/git/tags/${encodeURIComponent(sha)}`,
    );
    if (!tagResponse.ok || !tagResponse.json || typeof tagResponse.json !== "object") {
      return { ok: false, error: `Annotated tag '${tag}' could not be dereferenced.` };
    }
    object = (tagResponse.json as Record<string, unknown>).object as
      Record<string, unknown> | undefined;
  }
  return { ok: false, error: `Release/tag '${tag}' exceeds the dereference limit.` };
}

function normalizeGitOid(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(value)) {
    return undefined;
  }
  return value.toLowerCase();
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
