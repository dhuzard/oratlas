import "server-only";
import { isExactCommitSha, isSafeRepoRelativePath, preservedFilesSchema } from "@oratlas/contracts";
import { prisma, parseJsonColumn } from "./db";
import { sha256 } from "./hash";
import { isReadablePublicState } from "./review-lifecycle";

export type ArticleBlock =
  | { kind: "heading"; level: number; id: string; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; text: string; language?: string }
  | { kind: "list"; ordered: boolean; items: string[] };

export interface ArticleDocument {
  path: string;
  sha256: string;
  blocks: ArticleBlock[];
  toc: Array<{ id: string; level: number; text: string }>;
}

const ARTICLE_PATH_PRIORITY = [
  "review.md",
  "article.md",
  "manuscript.md",
  "paper.md",
  "README.md",
  "index.md",
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
  // Repository Markdown is data, never trusted HTML. We intentionally do not
  // produce active links or HTML; React later escapes this plain text.
  return safeUnicode(input).trimEnd();
}

function headingId(index: number, text: string): string {
  const slug = text
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `article-section-${index + 1}${slug ? `-${slug}` : ""}`;
}

/**
 * Small, deliberately non-HTML Markdown reader. It recognizes structure for
 * navigation while treating all inline markup and raw HTML as escaped text.
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
    // An unclosed fence is still inert code, never interpreted as markup.
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

/** Read a scholarly article only from the durable accepted snapshot. */
export async function getPreservedArticle(
  slug: string,
  versionId: string,
): Promise<ArticleDocument | null> {
  const version = await prisma.reviewVersion.findFirst({
    where: { id: versionId, review: { slug, status: "published" } },
    select: {
      publicState: true,
      snapshot: { select: { commitSha: true, preservedFilesJson: true } },
    },
  });
  if (
    !version ||
    !isReadablePublicState(version.publicState) ||
    !version.snapshot ||
    !isExactCommitSha(version.snapshot.commitSha) ||
    !version.snapshot.preservedFilesJson
  ) {
    return null;
  }
  const parsed = preservedFilesSchema.safeParse(
    parseJsonColumn<unknown>(version.snapshot.preservedFilesJson, null),
  );
  if (!parsed.success) return null;
  const path = chooseArticlePath(Object.keys(parsed.data));
  if (!path) return null;
  const file = parsed.data[path];
  if (!file || file.truncated) return null;
  const content = safeUnicode(file.content);
  return { path, sha256: sha256(content), ...parsePreservedMarkdown(content) };
}
