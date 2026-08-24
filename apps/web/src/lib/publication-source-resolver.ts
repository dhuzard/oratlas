import "server-only";
import { createFetchTransport, parseGithubRepoUrl } from "@oratlas/github";
import {
  PublicationSourceUnavailableError,
  type PublicationSourceResolver,
  type SourceDocumentBytes,
} from "@oratlas/publications";
import { getServerEnv } from "@oratlas/config";

interface GithubContentsResponse {
  type?: unknown;
  encoding?: unknown;
  content?: unknown;
  size?: unknown;
  sha?: unknown;
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(
        new PublicationSourceUnavailableError("the total source retrieval operation timed out."),
      );
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * Exact source retrieval currently supported by ORAtlas: public GitHub content
 * at a full immutable commit. DOI, archive and movable git refs deliberately do
 * not pretend to be source-byte capable.
 */
export function createPublicationSourceResolver(): PublicationSourceResolver {
  const transport = createFetchTransport({
    token: getServerEnv().GITHUB_TOKEN,
    maxResponseBytes: 8 * 1024 * 1024,
  });
  return {
    async resolve(source, documentPaths, options) {
      if (source.type !== "git") {
        throw new PublicationSourceUnavailableError(
          `source type ${source.type} has no exact-byte resolver in this ORAtlas deployment.`,
        );
      }
      if (!source.commit) {
        throw new PublicationSourceUnavailableError(
          "the git source does not declare a full immutable commit.",
        );
      }
      const parsed = parseGithubRepoUrl(source.repository);
      if (!parsed.ok) {
        throw new PublicationSourceUnavailableError(
          "only canonical public GitHub repository sources are currently supported.",
        );
      }
      const documents: SourceDocumentBytes[] = [];
      let totalBytes = 0;
      for (const path of documentPaths) {
        if (options.signal.aborted) {
          throw new PublicationSourceUnavailableError("the source retrieval operation timed out.");
        }
        const apiPath = `/repos/${encodeURIComponent(parsed.ref.owner)}/${encodeURIComponent(
          parsed.ref.name,
        )}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(
          source.commit,
        )}`;
        const response = await withAbort(transport.request(apiPath), options.signal);
        if (!response.ok) {
          throw new PublicationSourceUnavailableError(
            `GitHub did not return ${path} at the declared immutable commit.`,
          );
        }
        const value = response.json as GithubContentsResponse;
        if (
          value.type !== "file" ||
          value.encoding !== "base64" ||
          typeof value.content !== "string"
        ) {
          throw new PublicationSourceUnavailableError(
            `GitHub returned an unsupported source representation for ${path}.`,
          );
        }
        const encoded = value.content.replace(/\s+/gu, "");
        if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)) {
          throw new PublicationSourceUnavailableError(
            `GitHub returned malformed base64 source bytes for ${path}.`,
          );
        }
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.byteLength > options.maxDocumentBytes) {
          throw new PublicationSourceUnavailableError(
            `${path} exceeds the source-document byte limit.`,
          );
        }
        totalBytes += bytes.byteLength;
        if (totalBytes > options.maxTotalBytes) {
          throw new PublicationSourceUnavailableError(
            "The source documents exceed the total source-byte limit.",
          );
        }
        documents.push({
          path,
          bytes,
          mediaType: "text/markdown",
          requestedUrl: `https://api.github.com${apiPath}`,
          observedUrl: `https://api.github.com${apiPath}`,
          provenance: { status: response.status, redirects: [], headers: response.headers },
        });
      }
      return documents;
    },
  };
}
