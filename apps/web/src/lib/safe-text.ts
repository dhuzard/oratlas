/**
 * All repository-derived content is untrusted. We never render raw HTML from
 * submitted repositories (spec §17). React already escapes text nodes; this
 * module provides a minimal, safe Markdown-to-structured renderer for the small
 * amount of prose we display (abstracts, rationales), producing plain React
 * elements only — no HTML injection, no scripts, no arbitrary links executed.
 */

export interface SafeBlock {
  type: "paragraph" | "heading" | "list-item" | "code";
  text: string;
}

/** Parse a bounded subset of Markdown into safe text blocks (no inline HTML). */
export function toSafeBlocks(input: string, maxChars = 20_000): SafeBlock[] {
  const text = input.slice(0, maxChars);
  const lines = text.split(/\r?\n/);
  const blocks: SafeBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: "paragraph", text: paragraph.join(" ").trim() });
      paragraph = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flush();
    } else if (/^#{1,6}\s+/.test(line)) {
      flush();
      blocks.push({ type: "heading", text: line.replace(/^#{1,6}\s+/, "").trim() });
    } else if (/^[-*]\s+/.test(line)) {
      flush();
      blocks.push({ type: "list-item", text: line.replace(/^[-*]\s+/, "").trim() });
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks.filter((b) => b.text.length > 0);
}

/** Strip inline Markdown emphasis markers, returning plain text. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1");
}
