import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mystClaimRecordSchema,
  mystPublicationManifestSchema,
} from "../../../../packages/publications/src/adapters/myst.js";
import { PublicationSourceUnavailableError } from "@oratlas/publications";
import { createPublicationSourceResolver } from "./publication-source-resolver";

vi.mock("server-only", () => ({}));
vi.mock("@oratlas/config", () => ({ getServerEnv: () => ({ GITHUB_TOKEN: undefined }) }));

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
// Read committed blobs verbatim: Windows checkout line-ending conversion must
// not reinterpret or normalize the producer's digest-pinned artifact bytes.
const bytes = (path: string) =>
  execFileSync("git", ["show", `HEAD:scripts/producer-contracts/fixtures/${path}`], {
    cwd: repositoryRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
const pins = JSON.parse(bytes("pins.json").toString("utf8"));
const manifest = mystPublicationManifestSchema.parse(
  JSON.parse(bytes("myst/manifest.json").toString("utf8")),
);
const claims = bytes("myst/claims.jsonl")
  .toString("utf8")
  .trimEnd()
  .split("\n")
  .map((line) => mystClaimRecordSchema.parse(JSON.parse(line)));
const paths = [...new Set(claims.map((claim) => claim.source.documentPath))];

afterEach(() => vi.unstubAllGlobals());

describe("pinned MyST project-subdirectory source resolution (#221)", () => {
  it("keeps the emitted manifest, claims and source-document bytes at their exact pins", () => {
    expect(pins.myst.commit).toBe("51336a5446b449d4d661a4f46d8f8913a0bac2cb");
    expect(manifest.schemaVersion).toBe("0.2.0");
    expect(manifest.publication.source).toEqual({
      type: "git",
      repository: "https://github.com/dhuzard/oratlas-myst",
      commit: pins.myst.commit,
    });
    expect(paths).toEqual(["index.md", "results.md"]);
    for (const path of ["myst/manifest.json", "myst/claims.jsonl"]) {
      expect(sha256(bytes(path))).toBe(pins.files[path]);
    }
    for (const claim of claims) {
      expect(["index.md", "results.md"]).toContain(claim.source.documentPath);
      const path = `myst/source/${claim.source.documentPath}`;
      expect(sha256(bytes(path))).toBe(pins.files[path]);
      expect(sha256(bytes(path))).toBe(claim.source.documentSha256);
    }
  });

  it.each(paths)(
    "does not guess examples/basic when immutable-root %s is unavailable",
    async (path) => {
      const requests: string[] = [];
      // The 404s model unavailable repository-root paths, not a captured live API
      // response. Even if a guessed examples/basic path would supply valid bytes,
      // the resolver must not infer that producer-specific directory mapping.
      const fetchMock = vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requests.push(url);
        const parsed = new URL(url);
        if (parsed.pathname === `/repos/dhuzard/oratlas-myst/contents/examples/basic/${path}`) {
          return new Response(
            JSON.stringify({
              type: "file",
              encoding: "base64",
              content: bytes(`myst/source/${path}`).toString("base64"),
            }),
            { status: 200 },
          );
        }
        return new Response('{"message":"Not Found"}', { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);
      const resolver = createPublicationSourceResolver();
      await expect(
        resolver.resolve(manifest.publication.source!, [path], {
          signal: new AbortController().signal,
          maxDocumentBytes: 4 * 1024 * 1024,
          maxTotalBytes: 8 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({
        name: PublicationSourceUnavailableError.name,
        reason: `GitHub did not return ${path} at the declared immutable commit.`,
      });
      expect(requests).toEqual([
        `https://api.github.com/repos/dhuzard/oratlas-myst/contents/${path}?ref=${pins.myst.commit}`,
      ]);
      expect(requests.some((url) => url.includes("examples/basic"))).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
