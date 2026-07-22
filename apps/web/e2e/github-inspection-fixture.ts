import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const FIRST_COMMIT_SHA = "d".repeat(40);
const FIRST_TREE_SHA = "e".repeat(40);
const SECOND_COMMIT_SHA = "f".repeat(40);
const SECOND_TREE_SHA = "a".repeat(40);
const FOLLOW_UP_TAG = "follow-up-v2";
const ethicalDebtFixture = JSON.parse(
  readFileSync(
    new URL(
      "../../../packages/extractor/src/fixtures/ethical-debt-v0.1.0-trust-preview.3/fixture.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as EthicalDebtFixture;

if (process.env.ORATLAS_E2E_GITHUB_FIXTURE === "1") {
  const upstreamFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.github.com") return upstreamFetch(input, init);
    if (request.method !== "GET") return jsonResponse(405, { message: "Method Not Allowed" });

    if (url.pathname.startsWith("/repos/dhuzard/ethical-debt-AI-review")) {
      return ethicalDebtResponse(url);
    }

    const match = /^\/repos\/e2e-lab\/(node-e2e-[^/]+)(\/.*)?$/.exec(url.pathname);
    if (!match) return jsonResponse(404, { message: "Not Found" });
    const repositoryName = decodeURIComponent(match[1]!);
    const githubRepositoryId = Number.parseInt(
      createHash("sha256").update(repositoryName).digest("hex").slice(0, 12),
      16,
    );
    const suffix = match[2] ?? "";
    const repositoryUrl = `https://github.com/e2e-lab/${repositoryName}`;
    const v1 = revision(repositoryUrl, false);
    const v2 = revision(repositoryUrl, true);

    if (!suffix) {
      return jsonResponse(200, {
        id: githubRepositoryId,
        name: repositoryName,
        full_name: `e2e-lab/${repositoryName}`,
        owner: { login: "e2e-lab" },
        html_url: repositoryUrl,
        private: false,
        fork: false,
        archived: false,
        default_branch: "main",
        description: "Offline causal node-publication fixture.",
        topics: ["open-science", "causal-e2e"],
        license: { spdx_id: "CC-BY-4.0" },
      });
    }
    if (suffix === "/commits/main") return commitResponse(FIRST_COMMIT_SHA);
    if (suffix === `/commits/${FIRST_COMMIT_SHA}`) return commitResponse(FIRST_COMMIT_SHA);
    if (suffix === `/commits/${SECOND_COMMIT_SHA}`) return commitResponse(SECOND_COMMIT_SHA);
    if (suffix === "/tags") {
      return jsonResponse(200, [{ name: FOLLOW_UP_TAG, commit: { sha: SECOND_COMMIT_SHA } }]);
    }
    if (suffix === "/releases") return jsonResponse(200, []);
    if (suffix === `/git/ref/tags/${FOLLOW_UP_TAG}`) {
      return jsonResponse(200, {
        ref: `refs/tags/${FOLLOW_UP_TAG}`,
        object: { type: "commit", sha: SECOND_COMMIT_SHA },
      });
    }
    if (suffix === `/git/commits/${FIRST_COMMIT_SHA}`) {
      return jsonResponse(200, { sha: FIRST_COMMIT_SHA, tree: { sha: FIRST_TREE_SHA } });
    }
    if (suffix === `/git/commits/${SECOND_COMMIT_SHA}`) {
      return jsonResponse(200, { sha: SECOND_COMMIT_SHA, tree: { sha: SECOND_TREE_SHA } });
    }
    if (suffix === "/pages") return jsonResponse(404, { message: "Not Found" });
    if (suffix === `/git/trees/${FIRST_TREE_SHA}`) return treeResponse(v1.files);
    if (suffix === `/git/trees/${SECOND_TREE_SHA}`) return treeResponse(v2.files);
    if (suffix.startsWith("/contents/")) {
      const path = decodeURIComponent(suffix.slice("/contents/".length));
      const selected = url.searchParams.get("ref") === SECOND_COMMIT_SHA ? v2 : v1;
      const content = selected.files[path];
      return content === undefined
        ? jsonResponse(404, { message: "Not Found" })
        : contentResponse(content);
    }
    return jsonResponse(404, { message: "Not Found" });
  };
}

interface EthicalDebtFixture {
  repository: {
    githubRepositoryId: string;
    name: string;
    owner: string;
    canonicalUrl: string;
    defaultBranch: string;
  };
  source: {
    commitSha: string;
    treeSha: string;
    releaseTag?: string;
    releaseUrl?: string;
    sourceCreatedAt?: string;
  };
  tree: Array<{ path: string; size: number; blobSha?: string }>;
  files: Record<string, { size: number; content: string }>;
}

function ethicalDebtResponse(url: URL): Response {
  const fixture = ethicalDebtFixture;
  const repoPath = `/repos/${fixture.repository.owner}/${fixture.repository.name}`;
  const suffix = url.pathname.slice(repoPath.length);
  const tag = fixture.source.releaseTag!;
  if (!suffix) {
    return jsonResponse(200, {
      id: Number(fixture.repository.githubRepositoryId),
      name: fixture.repository.name,
      full_name: `${fixture.repository.owner}/${fixture.repository.name}`,
      owner: { login: fixture.repository.owner },
      html_url: fixture.repository.canonicalUrl,
      private: false,
      fork: false,
      archived: false,
      default_branch: fixture.repository.defaultBranch,
    });
  }
  if (suffix === `/commits/${fixture.repository.defaultBranch}`) {
    return commitResponse(fixture.source.commitSha);
  }
  if (suffix === `/commits/${fixture.source.commitSha}`) {
    return commitResponse(fixture.source.commitSha);
  }
  if (suffix === "/tags") {
    return jsonResponse(200, [{ name: tag, commit: { sha: fixture.source.commitSha } }]);
  }
  if (suffix === "/releases") {
    return jsonResponse(200, [
      {
        tag_name: tag,
        name: tag,
        html_url: fixture.source.releaseUrl,
        published_at: fixture.source.sourceCreatedAt ?? null,
        draft: false,
        prerelease: true,
        body: "",
      },
    ]);
  }
  if (suffix === `/git/ref/tags/${tag}`) {
    return jsonResponse(200, {
      ref: `refs/tags/${tag}`,
      object: { type: "commit", sha: fixture.source.commitSha },
    });
  }
  if (suffix === `/git/commits/${fixture.source.commitSha}`) {
    return jsonResponse(200, {
      sha: fixture.source.commitSha,
      tree: { sha: fixture.source.treeSha },
    });
  }
  if (suffix === "/pages") return jsonResponse(404, { message: "Not Found" });
  if (suffix === `/git/trees/${fixture.source.treeSha}`) {
    return jsonResponse(200, {
      truncated: false,
      tree: fixture.tree.map((entry) => ({
        path: entry.path,
        type: "blob",
        size: entry.size,
        sha: entry.blobSha,
      })),
    });
  }
  if (suffix.startsWith("/contents/")) {
    const path = decodeURIComponent(suffix.slice("/contents/".length));
    const file = fixture.files[path];
    return file ? contentResponse(file.content) : jsonResponse(404, { message: "Not Found" });
  }
  return jsonResponse(404, { message: "Not Found" });
}

function revision(repositoryUrl: string, followUp: boolean) {
  const commitSha = followUp ? SECOND_COMMIT_SHA : FIRST_COMMIT_SHA;
  const claim = {
    id: "claim:e2e",
    kind: "claim",
    title: followUp ? "E2E causal source head v2" : 'Escaped <script>alert("node")</script>',
    text: followUp
      ? "The second immutable source head adds a causal follow-up result."
      : 'Literal markup: <img src=x onerror="alert(1)">',
    contributors: [{ displayName: "E2E Researcher" }],
    license: "CC-BY-4.0",
    provenance: { sourcePath: "nodes/claim.json", repositoryUrl, commitSha },
    payload: {
      statement: followUp
        ? "The follow-up source head reports a causal update."
        : "The e2e node is safely rendered.",
      qualifiers: [],
    },
  };
  const secondNode = followUp
    ? {
        id: "code:e2e-followup",
        kind: "code",
        title: "E2E follow-up analysis code",
        contributors: [{ displayName: "E2E Researcher" }],
        license: "CC-BY-4.0",
        provenance: { sourcePath: "nodes/follow-up-code.json", repositoryUrl, commitSha },
        payload: {
          entryPoints: ["src/follow-up.ts"],
          language: "TypeScript",
          releaseRef: "v2.0.0",
        },
      }
    : {
        id: "dataset:e2e",
        kind: "dataset",
        title: "E2E observations",
        contributors: [{ displayName: "E2E Researcher" }],
        license: "CC-BY-4.0",
        provenance: { sourcePath: "nodes/dataset.json", repositoryUrl, commitSha },
        payload: { artifactPath: "data/observations.csv", format: "text/csv", sizeBytes: 38 },
      };
  const secondNodePath = followUp ? "nodes/follow-up-code.json" : "nodes/dataset.json";
  const manifest = {
    schemaVersion: "1.0.0",
    nodes: { format: "json", files: ["nodes/claim.json", secondNodePath] },
    ...(followUp ? {} : { edges: { format: "jsonl", path: "nodes/edges.jsonl" } }),
  };
  const files: Record<string, string> = {
    "node-manifest.json": JSON.stringify(manifest, null, 2),
    "nodes/claim.json": JSON.stringify(claim, null, 2),
    [secondNodePath]: JSON.stringify(secondNode, null, 2),
  };
  if (followUp) {
    files["src/follow-up.ts"] = "export const followUp = true;\n";
  } else {
    files["data/observations.csv"] = "condition,value\ncontrol,1\ntreatment,2\n";
    files["nodes/edges.jsonl"] = [
      JSON.stringify({
        sourceNodeId: "claim:e2e",
        targetNodeId: "dataset:e2e",
        relationType: "uses-dataset",
        rationale: "The claim uses the captured observations.",
      }),
      JSON.stringify({
        sourceNodeId: "claim:e2e",
        targetNodeId: "dataset:e2e",
        relationType: "derives-from",
        rationale: "A second proposal exercises rejection.",
      }),
    ].join("\n");
  }
  return { files };
}

function commitResponse(sha: string): Response {
  return jsonResponse(200, {
    sha,
    commit: { committer: { date: "2026-06-01T00:00:00Z" } },
  });
}

function treeResponse(files: Record<string, string>): Response {
  return jsonResponse(200, {
    truncated: false,
    tree: Object.entries(files).map(([path, content]) => ({
      path,
      type: "blob",
      size: Buffer.byteLength(content, "utf8"),
      sha: gitBlobSha(content),
    })),
  });
}

function contentResponse(content: string): Response {
  return jsonResponse(200, {
    size: Buffer.byteLength(content, "utf8"),
    encoding: "base64",
    content: Buffer.from(content, "utf8").toString("base64"),
  });
}

function gitBlobSha(content: string): string {
  const bytes = Buffer.from(content, "utf8");
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
