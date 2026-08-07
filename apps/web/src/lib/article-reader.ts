import "server-only";
import { posix } from "node:path";
import { isExactCommitSha, isSafeRepoRelativePath, preservedFilesSchema } from "@oratlas/contracts";
import { mystParse } from "myst-parser";
import { parse as parseYaml } from "yaml";
import { prisma, parseJsonColumn } from "./db";
import { sha256 } from "./hash";
import { isReadablePublicState } from "./review-lifecycle";

export type ArticleBlock =
  | { kind: "heading"; level: number; id: string; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "list"; ordered: boolean; items: string[] };

export interface MystNode {
  type: string;
  children?: MystNode[];
  value?: string;
  [key: string]: unknown;
}

export interface SourceTrustComponent {
  name: string;
  score?: number;
  ruleId?: string;
  rationale?: string;
}

export interface SourceTrustClaim {
  claimId: string;
  claimText?: string;
  protocolVersion?: string;
  overallScore?: number;
  label?: string;
  capped?: boolean;
  capReasons: string[];
  humanReviewRequired?: boolean;
  components: SourceTrustComponent[];
}

export interface ArticlePage {
  path: string;
  id: string;
  title: string;
  depth: number;
  sha256: string;
  ast: MystNode;
  toc: Array<{ id: string; level: number; text: string }>;
  trustClaims: SourceTrustClaim[];
}

export interface ArticleDocument {
  /** First page, retained as the source summary for older callers. */
  path: string;
  sha256: string;
  pages: ArticlePage[];
  toc: Array<{ id: string; level: number; text: string }>;
  navigation: Array<{ pageId: string; path: string; title: string; depth: number }>;
  sourceTrustCount: number;
  rendering: "myst-ast" | "safe-markdown";
  /** Legacy structural representation used by parser tests and fallback deposits. */
  blocks: ArticleBlock[];
}

type PreservedFiles = ReturnType<typeof preservedFilesSchema.parse>;

const ARTICLE_PATH_PRIORITY = [
  "review.md",
  "article.md",
  "manuscript.md",
  "paper.md",
  "README.md",
  "index.md",
] as const;

const TRUST_GRAPH_PATHS = [
  "knowledge/claim_graph.json",
  "knowledge/trust_score_report.json",
  "knowledge/claim_index.json",
] as const;

/** Replace invalid UTF-16 scalar sequences before framework UTF-8 encoding. */
export function safeUnicode(input: string): string {
  let output = "";
  for (let index = 0; index < input.length; index++) {
    const unit = input.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        output += input[index]! + input[index + 1]!;
        index++;
      } else {
        output += "\uFFFD";
      }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      output += "\uFFFD";
    } else {
      output += input[index]!;
    }
  }
  return output;
}

function visibleText(input: string): string {
  return safeUnicode(input).trimEnd();
}

function slugPart(input: string): string {
  return input
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function headingId(index: number, text: string): string {
  const slug = slugPart(text);
  return `article-section-${index + 1}${slug ? `-${slug}` : ""}`;
}

/**
 * Legacy non-HTML Markdown reader retained for deposits without a MyST project.
 * Inline repository HTML remains inert text.
 */
export function parsePreservedMarkdown(content: string): Pick<ArticleDocument, "blocks" | "toc"> {
  const lines = safeUnicode(content).replace(/\r\n?/g, "\n").split("\n");
  const blocks: ArticleBlock[] = [];
  const toc: ArticleDocument["toc"] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: { language?: string; lines: string[] } | null = null;
  let inFrontmatter = lines[0]?.trim() === "---";

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: visibleText(paragraph.join("\n")) });
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ kind: "list", ordered: list.ordered, items: list.items });
    list = null;
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]!;
    if (inFrontmatter) {
      if (lineIndex > 0 && line.trim() === "---") inFrontmatter = false;
      continue;
    }
    const fence = line.match(/^\s*```([^`]*)$/);
    if (fence) {
      flushParagraph();
      flushList();
      if (code) {
        blocks.push({
          kind: "code",
          text: visibleText(code.lines.join("\n")),
          language: code.language,
        });
        code = null;
      } else {
        const language = visibleText(fence[1] ?? "").slice(0, 40) || undefined;
        code = { language, lines: [] };
      }
      continue;
    }
    if (code) {
      code.lines.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      const text = visibleText(heading[2]!);
      const id = headingId(toc.length, text);
      const entry = { id, level: heading[1]!.length, text };
      toc.push(entry);
      blocks.push({ kind: "heading", ...entry });
      continue;
    }
    const item = line.match(/^\s*(?:(\d+)[.)]|[-+*])\s+(.+)$/);
    if (item) {
      flushParagraph();
      const ordered = Boolean(item[1]);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(visibleText(item[2]!));
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  if (code) {
    blocks.push({
      kind: "code",
      text: visibleText(code.lines.join("\n")),
      language: code.language,
    });
  }
  flushParagraph();
  flushList();
  return { blocks, toc };
}

function chooseArticlePath(paths: string[]): string | null {
  const safeMarkdown = paths.filter(
    (path) => isSafeRepoRelativePath(path) && /(?:^|\/)\w[^/]*\.md$/i.test(path),
  );
  for (const preferred of ARTICLE_PATH_PRIORITY) {
    const exact = safeMarkdown.find((path) => path.toLowerCase() === preferred.toLowerCase());
    if (exact) return exact;
  }
  return safeMarkdown.sort((a, b) => a.localeCompare(b))[0] ?? null;
}

interface MystNavigationEntry {
  path: string;
  title?: string;
  depth: number;
}

function mystNavigation(files: PreservedFiles): MystNavigationEntry[] {
  const configPath = files["myst.yml"] ? "myst.yml" : files["myst.yaml"] ? "myst.yaml" : undefined;
  const config = configPath ? files[configPath] : undefined;
  if (!config || config.truncated) return [];
  let parsed: unknown;
  try {
    parsed = parseYaml(config.content);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const project = (parsed as Record<string, unknown>).project;
  if (!project || typeof project !== "object" || Array.isArray(project)) return [];
  const entries: MystNavigationEntry[] = [];
  const visit = (value: unknown, depth: number): void => {
    if (entries.length >= 64 || !value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth);
      return;
    }
    if (typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (typeof item.file === "string") {
      const path = item.file.replace(/\\/g, "/").replace(/^\.\//, "");
      if (isSafeRepoRelativePath(path) && /\.(?:md|ipynb)$/i.test(path)) {
        entries.push({
          path,
          title: typeof item.title === "string" ? safeUnicode(item.title).trim() : undefined,
          depth,
        });
      }
    }
    if (item.children) visit(item.children, depth + 1);
  };
  visit((project as Record<string, unknown>).toc, 0);
  return entries;
}

function textOf(node: MystNode | undefined): string {
  if (!node) return "";
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(textOf).join("");
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? safeUnicode(value).trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map(safeUnicode)
    : [];
}

function sourceTrustFromRecord(record: Record<string, unknown>): SourceTrustClaim | undefined {
  const claimId = stringValue(record.claim_id ?? record.claimId ?? record.id);
  if (!claimId) return undefined;
  const score = objectValue(record.trust_score ?? record.trustScore ?? record.score);
  const componentsValue = objectValue(score?.components);
  const components = componentsValue
    ? Object.entries(componentsValue).map(([name, value]) => {
        const component = objectValue(value);
        return {
          name,
          score: numberValue(component?.score),
          ruleId: stringValue(component?.rule_id ?? component?.ruleId),
          rationale: stringValue(component?.rationale),
        };
      })
    : [];
  return {
    claimId,
    claimText: stringValue(record.claim_text ?? record.claimText),
    protocolVersion: stringValue(score?.rubric_version ?? score?.protocolVersion),
    overallScore: numberValue(score?.overall_score ?? score?.overallScore),
    label: stringValue(score?.trust_label ?? score?.label),
    capped: typeof score?.capped === "boolean" ? score.capped : undefined,
    capReasons: stringArray(score?.cap_reasons ?? score?.capReasons),
    humanReviewRequired:
      typeof record.human_review_required === "boolean"
        ? record.human_review_required
        : typeof record.humanReviewRequired === "boolean"
          ? record.humanReviewRequired
          : undefined,
    components,
  };
}

function trustIndex(files: PreservedFiles): Map<string, SourceTrustClaim> {
  const index = new Map<string, SourceTrustClaim>();
  let visited = 0;
  const visit = (value: unknown): void => {
    if (visited++ > 100_000 || !value) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = objectValue(value);
    if (!record) return;
    const claim = sourceTrustFromRecord(record);
    if (claim && !index.has(claim.claimId)) index.set(claim.claimId, claim);
    for (const child of Object.values(record)) {
      if (child && typeof child === "object") visit(child);
    }
  };
  for (const path of TRUST_GRAPH_PATHS) {
    const file = files[path];
    if (!file || file.truncated) continue;
    try {
      visit(JSON.parse(file.content));
    } catch {
      // Malformed source assertions fail closed and remain available as files.
    }
  }
  return index;
}

function directiveOptions(node: MystNode): Record<string, string> {
  const result: Record<string, string> = {};
  const raw = `${typeof node.args === "string" ? node.args : ""}\n${node.value ?? ""}`;
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*:([a-z0-9_-]+):\s*(.*?)\s*$/i.exec(line);
    if (match) result[match[1]!.toLowerCase()] = safeUnicode(match[2] ?? "");
  }
  return result;
}

function safeUrl(url: string): string | undefined {
  const value = safeUnicode(url).trim();
  if (!value) return undefined;
  if (/^(?:https?:|mailto:|#)/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return undefined;
  return value;
}

function resolveRepoPath(documentPath: string, target: string): string | undefined {
  const clean = target.split(/[?#]/, 1)[0] ?? "";
  const resolved = posix.normalize(posix.join(posix.dirname(documentPath), clean));
  return isSafeRepoRelativePath(resolved) ? resolved : undefined;
}

interface TransformContext {
  pageId: string;
  pagePath: string;
  repositoryOwner: string;
  repositoryName: string;
  commitSha: string;
  pagePaths: Set<string>;
  trust: Map<string, SourceTrustClaim>;
  trustClaims: SourceTrustClaim[];
  toc: ArticlePage["toc"];
  key: number;
}

function transformMystNode(input: MystNode, context: TransformContext): MystNode | null {
  const key = `${context.pageId}-${context.key++}`;
  if (["html", "iframe", "raw"].includes(input.type)) {
    return {
      type: "code",
      key,
      lang: input.type === "html" ? "html" : "text",
      value: safeUnicode(typeof input.value === "string" ? input.value : `[${input.type} omitted]`),
    };
  }
  if (input.type === "mystDirective") {
    const name = typeof input.name === "string" ? input.name.toLowerCase() : "unknown";
    if (name === "trust-claim") {
      const options = directiveOptions(input);
      const claimId = options["claim-id"] ?? options.claim;
      if (!claimId) return null;
      const source = context.trust.get(claimId);
      const fallbackScore = Number(options.score);
      const claim: SourceTrustClaim = source ?? {
        claimId,
        claimText: options.quote ?? options.claim,
        overallScore: Number.isFinite(fallbackScore) ? fallbackScore : undefined,
        label: options.label,
        capReasons: [],
        components: [],
      };
      if (!context.trustClaims.some((item) => item.claimId === claim.claimId)) {
        context.trustClaims.push(claim);
      }
      return { type: "trustClaimMarker", key, trustClaim: claim };
    }
    return {
      type: "admonition",
      key,
      kind: "note",
      children: [
        {
          type: "admonitionTitle",
          key: `${key}-title`,
          children: [{ type: "text", value: `MyST extension: ${name}`, key: `${key}-title-text` }],
        },
        {
          type: "paragraph",
          key: `${key}-body`,
          children: [
            {
              type: "text",
              value: safeUnicode(input.value ?? "This extension has no safe native renderer."),
              key: `${key}-body-text`,
            },
          ],
        },
      ],
    };
  }

  const node: MystNode = { ...input, key };
  delete node.style;
  delete node.class;
  delete node.html;
  if (typeof node.value === "string") node.value = safeUnicode(node.value);
  if (node.type === "link" && typeof node.url === "string") {
    const url = safeUrl(node.url);
    if (!url) return { type: "text", value: textOf(input), key };
    node.url = url;
    if (!/^(?:https?:|mailto:|#)/i.test(url)) {
      const path = resolveRepoPath(context.pagePath, url);
      if (path && context.pagePaths.has(path)) node.articlePagePath = path;
    }
  }
  if (node.type === "image" && typeof node.url === "string") {
    const url = safeUrl(node.url);
    if (!url) return null;
    if (!/^(?:https?:|#)/i.test(url)) {
      const path = resolveRepoPath(context.pagePath, url);
      if (!path) return null;
      node.url = `https://raw.githubusercontent.com/${encodeURIComponent(context.repositoryOwner)}/${encodeURIComponent(context.repositoryName)}/${context.commitSha}/${path.split("/").map(encodeURIComponent).join("/")}`;
      node.sourcePath = path;
    } else {
      node.url = url;
    }
  }
  if (node.type === "heading") {
    // The review record already owns the page-level h1. Preserved source h1s
    // begin at h2 so the full article remains a valid nested document.
    const depth = typeof node.depth === "number" ? Math.min(Math.max(node.depth, 2), 6) : 2;
    const text = textOf(node) || "Section";
    const id = `myst-${context.pageId}-${context.toc.length + 1}-${slugPart(text) || "section"}`;
    node.depth = depth;
    node.html_id = id;
    context.toc.push({ id, level: depth, text });
  }
  if (input.children) {
    node.children = input.children
      .map((child) => transformMystNode(child, context))
      .filter((child): child is MystNode => Boolean(child));
  }
  return node;
}

function notebookAst(content: string): MystNode {
  let notebook: unknown;
  try {
    notebook = JSON.parse(content);
  } catch {
    return { type: "root", children: [{ type: "code", lang: "json", value: content }] };
  }
  const record = objectValue(notebook);
  const cells = Array.isArray(record?.cells) ? record.cells : [];
  const children: MystNode[] = [];
  for (const [index, value] of cells.entries()) {
    const cell = objectValue(value);
    if (!cell) continue;
    const source = Array.isArray(cell.source)
      ? cell.source.filter((part): part is string => typeof part === "string").join("")
      : typeof cell.source === "string"
        ? cell.source
        : "";
    if (cell.cell_type === "markdown") {
      children.push(...((mystParse(safeUnicode(source)) as MystNode).children ?? []));
    } else if (cell.cell_type === "code") {
      children.push({
        type: "code",
        lang: "python",
        value: safeUnicode(source),
        label: `Cell ${index + 1}`,
      });
      const outputs = Array.isArray(cell.outputs) ? cell.outputs : [];
      for (const output of outputs) {
        const outputRecord = objectValue(output);
        const text = Array.isArray(outputRecord?.text)
          ? outputRecord.text.filter((part): part is string => typeof part === "string").join("")
          : typeof outputRecord?.text === "string"
            ? outputRecord.text
            : undefined;
        if (text) children.push({ type: "code", lang: "text", value: safeUnicode(text) });
      }
    }
  }
  return { type: "root", children };
}

function firstHeading(ast: MystNode): string | undefined {
  const heading = ast.children?.find((node) => node.type === "heading");
  return heading ? textOf(heading).trim() || undefined : undefined;
}

export function buildMystArticle(input: {
  files: PreservedFiles;
  repositoryOwner: string;
  repositoryName: string;
  commitSha: string;
}): ArticleDocument | null {
  const declared = mystNavigation(input.files);
  const fallbackPath = chooseArticlePath(Object.keys(input.files));
  const navigation =
    declared.length > 0 ? declared : fallbackPath ? [{ path: fallbackPath, depth: 0 }] : [];
  const available = navigation.filter((entry) => {
    const file = input.files[entry.path];
    return Boolean(file && !file.truncated);
  });
  if (available.length === 0) return null;
  const pagePaths = new Set(available.map((entry) => entry.path));
  const trust = trustIndex(input.files);
  const pages: ArticlePage[] = [];
  for (const [index, entry] of available.entries()) {
    const file = input.files[entry.path]!;
    const content = safeUnicode(file.content);
    const parsed = entry.path.toLowerCase().endsWith(".ipynb")
      ? notebookAst(content)
      : (mystParse(content) as MystNode);
    const id = `page-${index + 1}-${slugPart(entry.path) || "document"}`;
    const pageToc: ArticlePage["toc"] = [];
    const trustClaims: SourceTrustClaim[] = [];
    const ast = transformMystNode(parsed, {
      pageId: id,
      pagePath: entry.path,
      repositoryOwner: input.repositoryOwner,
      repositoryName: input.repositoryName,
      commitSha: input.commitSha,
      pagePaths,
      trust,
      trustClaims,
      toc: pageToc,
      key: 0,
    }) ?? { type: "root", children: [] };
    pages.push({
      path: entry.path,
      id,
      title:
        entry.title ??
        firstHeading(parsed) ??
        posix.basename(entry.path).replace(/\.(?:md|ipynb)$/i, ""),
      depth: entry.depth,
      sha256: sha256(content),
      ast,
      toc: pageToc,
      trustClaims,
    });
  }
  const first = pages[0]!;
  const legacy = parsePreservedMarkdown(input.files[first.path]!.content);
  return {
    path: first.path,
    sha256: first.sha256,
    pages,
    toc: first.toc,
    navigation: pages.map(({ id: pageId, path, title, depth }) => ({ pageId, path, title, depth })),
    sourceTrustCount: pages.reduce((sum, page) => sum + page.trustClaims.length, 0),
    rendering: declared.length > 0 ? "myst-ast" : "safe-markdown",
    blocks: legacy.blocks,
  };
}

/** Read a scholarly article only from the durable accepted snapshot. */
export async function getPreservedArticle(
  slug: string,
  versionId: string,
): Promise<ArticleDocument | null> {
  const version = await prisma.reviewVersion.findFirst({
    where: { id: versionId, review: { slug, status: "published" } },
    select: {
      publicState: true,
      snapshot: {
        select: {
          commitSha: true,
          preservedFilesJson: true,
          repository: { select: { owner: true, name: true } },
        },
      },
    },
  });
  if (
    !version ||
    !isReadablePublicState(version.publicState) ||
    !version.snapshot ||
    !isExactCommitSha(version.snapshot.commitSha) ||
    !version.snapshot.preservedFilesJson
  )
    return null;
  const parsed = preservedFilesSchema.safeParse(
    parseJsonColumn<unknown>(version.snapshot.preservedFilesJson, null),
  );
  if (!parsed.success) return null;
  return buildMystArticle({
    files: parsed.data,
    repositoryOwner: version.snapshot.repository.owner,
    repositoryName: version.snapshot.repository.name,
    commitSha: version.snapshot.commitSha,
  });
}
