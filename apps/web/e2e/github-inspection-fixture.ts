import { createHash } from "node:crypto";

const FIRST_COMMIT_SHA = "d".repeat(40);
const FIRST_TREE_SHA = "e".repeat(40);
const SECOND_COMMIT_SHA = "f".repeat(40);
const SECOND_TREE_SHA = "a".repeat(40);
const FOLLOW_UP_TAG = "follow-up-v2";

if (process.env.ORATLAS_E2E_GITHUB_FIXTURE === "1") {
  const upstreamFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== "https://api.github.com") return upstreamFetch(input, init);
    if (request.method !== "GET") return jsonResponse(405, { message: "Method Not Allowed" });

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
