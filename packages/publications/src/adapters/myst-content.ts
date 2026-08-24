import { createHash } from "node:crypto";
import { z } from "zod";
import {
  normalizedPublicationContentSchema,
  safeRepoRelativePathSchema,
  type NormalizedPublicationContent,
  type PublicationContentRole,
} from "@oratlas/contracts";
import {
  PublicationAdapterError,
  publicationArtifactIdentitySha256,
  type CapturedPublicationArtifact,
  type PublicationAdapterContentNormalizationContext,
} from "../adapter.js";

const xrefSchema = z
  .object({
    references: z
      .array(
        z
          .object({
            url: z.string().min(1).max(2_000),
            data: safeRepoRelativePathSchema,
          })
          .passthrough(),
      )
      .max(100_000),
  })
  .passthrough();

const SAFE_CONTAINER_TYPES = new Set([
  "root",
  "paragraph",
  "heading",
  "blockquote",
  "list",
  "listItem",
  "table",
  "tableRow",
  "tableCell",
  "strong",
  "emphasis",
  "delete",
  "link",
  "linkReference",
  "figure",
  "caption",
  "figcaption",
  "footnoteDefinition",
]);
const UNSAFE_TYPES = new Set([
  "html",
  "raw",
  "script",
  "iframe",
  "plugin",
  "pluginOutput",
  "output",
  "executable",
  "mystDirective",
]);

function decodeJson(artifact: CapturedPublicationArtifact, label: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(artifact.bytes);
  } catch {
    throw new PublicationAdapterError(`${label} is not valid UTF-8.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PublicationAdapterError(`${label} is not valid JSON.`);
  }
}

function safePublishedUrl(baseUrl: string, value: string): string | null {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0)!;
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    return null;
  }
  const base = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  const resolved = new URL(value.replace(/^\/+/, ""), base);
  resolved.hash = "";
  if (
    resolved.protocol !== "https:" ||
    resolved.origin !== base.origin ||
    !resolved.pathname.startsWith(base.pathname)
  ) {
    return null;
  }
  return resolved.href;
}

function normalizedInline(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

interface RenderState {
  visited: number;
  maxNodes: number;
  firstHeading: string | null;
  truncated: boolean;
}

function childrenOf(node: Record<string, unknown>): unknown[] {
  return Array.isArray(node.children) ? node.children : [];
}

function renderChildren(node: Record<string, unknown>, state: RenderState, depth: number): string {
  return childrenOf(node)
    .map((child) => renderNode(child, state, depth + 1))
    .filter(Boolean)
    .join(" ");
}

function renderNode(value: unknown, state: RenderState, depth = 0): string {
  state.visited += 1;
  if (state.visited > state.maxNodes || depth > 128) {
    state.truncated = true;
    return "";
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "";
  const node = value as Record<string, unknown>;
  const type = typeof node.type === "string" ? node.type : "";
  if (UNSAFE_TYPES.has(type)) return "";
  if (type === "text") return typeof node.value === "string" ? node.value : "";
  if (type === "inlineCode") {
    return typeof node.value === "string" ? `\`${node.value}\`` : "";
  }
  if (type === "code") {
    return typeof node.value === "string" ? `Code:\n${node.value}` : "";
  }
  if (type === "inlineMath") {
    return typeof node.value === "string" ? `$${node.value}$` : "";
  }
  if (type === "math") {
    return typeof node.value === "string" ? `$$${node.value}$$` : "";
  }
  if (type === "image") {
    return typeof node.alt === "string" ? normalizedInline(node.alt) : "";
  }
  if (type === "thematicBreak") return "---";

  const oratlas =
    typeof node.data === "object" && node.data !== null
      ? (node.data as { oratlas?: unknown }).oratlas
      : undefined;
  const isClaimContainer =
    type === "container" &&
    typeof oratlas === "object" &&
    oratlas !== null &&
    (oratlas as { kind?: unknown }).kind === "claim";
  if (!SAFE_CONTAINER_TYPES.has(type) && !isClaimContainer) return "";

  const rendered = renderChildren(node, state, depth);
  if (type === "heading") {
    const heading = normalizedInline(rendered);
    if (!state.firstHeading && heading) state.firstHeading = heading;
    const depthValue = typeof node.depth === "number" ? Math.max(1, Math.min(6, node.depth)) : 1;
    return heading ? `${"#".repeat(depthValue)} ${heading}\n\n` : "";
  }
  if (
    type === "paragraph" ||
    type === "blockquote" ||
    type === "caption" ||
    type === "figcaption"
  ) {
    const paragraph = normalizedInline(rendered);
    return paragraph ? `${paragraph}\n\n` : "";
  }
  if (type === "listItem") {
    const item = normalizedInline(rendered);
    return item ? `- ${item}\n` : "";
  }
  if (type === "list" || type === "table" || type === "figure" || type === "footnoteDefinition") {
    return rendered ? `${rendered.trimEnd()}\n\n` : "";
  }
  if (type === "tableRow") return rendered ? `${normalizedInline(rendered)}\n` : "";
  if (type === "tableCell") return rendered ? `${normalizedInline(rendered)} | ` : "";
  return rendered;
}

function normalizeRenderedText(value: string): string {
  return value
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function roleFromTitle(title: string | null): PublicationContentRole | null {
  if (!title) return null;
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z]+/gu, " ")
    .trim();
  if (/\babstract\b/u.test(normalized)) return "abstract";
  if (/\bintroduction\b|\bbackground\b/u.test(normalized)) return "introduction";
  if (/\bmethods?\b|\bmethodology\b|\bmaterials and methods\b/u.test(normalized)) return "methods";
  if (/\bresults?\b|\bfindings?\b/u.test(normalized)) return "results";
  if (/\bdiscussion\b/u.test(normalized)) return "discussion";
  if (/\blimitations?\b/u.test(normalized)) return "limitations";
  if (/\breferences?\b|\bbibliography\b/u.test(normalized)) return "references";
  if (/\bsupplement(?:ary|al)?\b/u.test(normalized)) return "supplementary";
  return null;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeMystPublicationContent(
  artifacts: readonly CapturedPublicationArtifact[],
  context: PublicationAdapterContentNormalizationContext,
): NormalizedPublicationContent {
  const xrefArtifact = artifacts.find(
    (artifact) => artifact.artifactKind === "cross-reference-inventory",
  );
  if (!xrefArtifact) {
    throw new PublicationAdapterError(
      "Content normalization requires the captured MyST inventory.",
    );
  }
  const parsedXref = xrefSchema.safeParse(decodeJson(xrefArtifact, "MyST inventory"));
  if (!parsedXref.success) {
    throw new PublicationAdapterError("The captured MyST inventory cannot bound content coverage.");
  }
  const knownPaths = [
    ...new Set(parsedXref.data.references.map((reference) => reference.data)),
  ].sort();
  const publishedUrls = new Map<string, string>();
  for (const reference of [...parsedXref.data.references].sort((left, right) =>
    left.url.localeCompare(right.url),
  )) {
    const publishedUrl = safePublishedUrl(context.publicationBaseUrl, reference.url);
    if (publishedUrl && !publishedUrls.has(reference.data)) {
      publishedUrls.set(reference.data, publishedUrl);
    }
  }

  const pages = artifacts
    .filter(
      (artifact): artifact is CapturedPublicationArtifact & { declaredPath: string } =>
        artifact.artifactKind === "published-page-data" && artifact.declaredPath !== undefined,
    )
    .sort((left, right) => left.declaredPath.localeCompare(right.declaredPath));
  let truncated = pages.length < knownPaths.length;
  let totalBytes = 0;
  const documents: NormalizedPublicationContent["documents"] = [];
  for (const artifact of pages.slice(0, context.limits.maxDocuments)) {
    if (artifact.bytes.byteLength > context.limits.maxBytesPerDocument) {
      truncated = true;
      continue;
    }
    totalBytes += artifact.bytes.byteLength;
    if (totalBytes > context.limits.maxTotalBytes) {
      truncated = true;
      break;
    }
    const page = decodeJson(artifact, `Published page data ${artifact.declaredPath}`);
    const pageRecord =
      typeof page === "object" && page !== null ? (page as Record<string, unknown>) : {};
    const state: RenderState = {
      visited: 0,
      maxNodes: context.limits.maxNodesPerDocument,
      firstHeading: null,
      truncated: false,
    };
    let text = normalizeRenderedText(renderNode(pageRecord.mdast, state));
    if (state.truncated) truncated = true;
    if (!text) continue;
    if (text.length > context.limits.maxTextLength) {
      text = text.slice(0, context.limits.maxTextLength).trimEnd();
      truncated = true;
    }
    const declaredTitle =
      typeof pageRecord.title === "string" && pageRecord.title.trim()
        ? pageRecord.title.trim().slice(0, 500)
        : null;
    const title = declaredTitle ?? state.firstHeading?.slice(0, 500) ?? null;
    const artifactIdentity = publicationArtifactIdentitySha256(artifact);
    documents.push({
      id: `publication-content:${digest(
        `${context.publicationVersionStableKey}\n${artifactIdentity}\npublished-structured-text`,
      )}`,
      title,
      role: roleFromTitle(title),
      sourcePath: artifact.declaredPath,
      publishedUrl: publishedUrls.get(artifact.declaredPath) ?? null,
      representation: "published-structured-text" as const,
      text,
      sha256: digest(text),
      sourceArtifactIdentitySha256: artifactIdentity,
      sourceArtifactSha256: artifact.contentSha256,
    });
  }
  if (pages.length > context.limits.maxDocuments) truncated = true;
  return normalizedPublicationContentSchema.parse({
    documents,
    completeness: {
      returnedDocuments: documents.length,
      totalDocumentsKnown: knownPaths.length,
      truncated: truncated || documents.length < pages.length,
      // MyST 0.2.0 exposes an xref inventory, not an authoritative complete
      // document manifest. Never overstate whole-publication coverage.
      coverage: documents.length === 0 ? "unknown" : "partial",
    },
  });
}
