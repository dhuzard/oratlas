import "server-only";
import { type PublicationSourceDescriptor } from "@oratlas/contracts";
import { createFetchTransport, parseGithubRepoUrl, type GithubTransport } from "@oratlas/github";
import { type PublicationSourceDocumentResolver } from "@oratlas/publications";
import { getServerEnv } from "@oratlas/config";

/**
 * Exact-byte source resolution for `source: { type: "git" }` on GitHub.
 *
 * Source-byte verification is only meaningful if the bytes it checks are the
 * exact bytes the publication was built from. That rules out most of what
 * "resolve a source" could loosely mean:
 *
 * - a **git** source without a pinned `commit` is refused, because a branch or
 *   a tag can move and the bytes behind it are not the bytes the digests were
 *   taken over;
 * - a **doi** source resolves to a landing page and metadata, not to the
 *   document bytes a claim record binds to, so no resolver claims it;
 * - an **archive** source would need a bundle to be unpacked, which means
 *   running an extractor over attacker-supplied input — a real attack surface,
 *   and one deliberately not opened here.
 *
 * Anything not resolvable exactly is reported as unavailable with a reason.
 * There is no approximate path: a publication that looked source-verified
 * without exact bytes ever being checked would be worse than one that plainly
 * says it reached published structure only.
 *
 * This resolver reads blobs through ORAtlas's existing GitHub transport at a
 * pinned commit. It never clones, never executes repository content, and never
 * shells out.
 */

const MAX_SOURCE_DOCUMENT_BYTES = 2 * 1024 * 1024;

function decodeBase64(value: string): string {
  return Buffer.from(value.replace(/\n/g, ""), "base64").toString("utf8");
}

export interface GithubSourceResolverOptions {
  transport?: GithubTransport;
  maxDocumentBytes?: number;
}

export function createGithubSourceDocumentResolver(
  options: GithubSourceResolverOptions = {},
): PublicationSourceDocumentResolver {
  const maxDocumentBytes = options.maxDocumentBytes ?? MAX_SOURCE_DOCUMENT_BYTES;
  const transport =
    options.transport ??
    createFetchTransport({
      ...(getServerEnv().GITHUB_TOKEN === undefined ? {} : { token: getServerEnv().GITHUB_TOKEN! }),
      maxResponseBytes: maxDocumentBytes * 2,
    });

  return {
    name: "github-blob-at-pinned-commit",

    supports(source: PublicationSourceDescriptor) {
      if (source.type !== "git") return { reason: "source-type-not-supported" } as const;
      if (source.commit === undefined) return { reason: "source-commit-not-declared" } as const;
      if (!parseGithubRepoUrl(source.repository).ok) {
        return { reason: "source-repository-not-supported" } as const;
      }
      return { supported: true } as const;
    },

    async readDocument(source: PublicationSourceDescriptor, documentPath: string) {
      if (source.type !== "git" || source.commit === undefined) {
        return { ok: false, reason: "source-type-not-supported" } as const;
      }
      const parsed = parseGithubRepoUrl(source.repository);
      if (!parsed.ok) return { ok: false, reason: "source-repository-not-supported" } as const;

      // The path already passed the safe-path rule; each segment is encoded so
      // it cannot alter the API route it is placed into.
      const encodedPath = documentPath.split("/").map(encodeURIComponent).join("/");
      const response = await transport.request(
        `/repos/${parsed.ref.owner}/${parsed.ref.name}/contents/${encodedPath}?ref=${encodeURIComponent(source.commit)}`,
      );
      if (!response.ok || typeof response.json !== "object" || response.json === null) {
        return { ok: false, reason: "source-document-unavailable" } as const;
      }
      const content = response.json as Record<string, unknown>;
      if (content.type !== "file" || content.encoding !== "base64") {
        return { ok: false, reason: "source-document-unavailable" } as const;
      }
      if (typeof content.size === "number" && content.size > maxDocumentBytes) {
        return { ok: false, reason: "source-document-unavailable" } as const;
      }
      if (typeof content.content !== "string") {
        return { ok: false, reason: "source-document-unavailable" } as const;
      }
      const text = decodeBase64(content.content);
      if (Buffer.byteLength(text, "utf8") > maxDocumentBytes) {
        return { ok: false, reason: "source-document-unavailable" } as const;
      }
      return { ok: true, text } as const;
    },
  };
}
