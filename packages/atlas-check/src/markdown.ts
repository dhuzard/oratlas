export interface MarkdownSection {
  heading: string;
  line: number;
  content: string;
}

/**
 * Extract Markdown sections without interpreting HTML. Fenced examples are
 * ignored so an untrusted code sample cannot satisfy a documentation rule.
 */
export function markdownSections(markdown: string): MarkdownSection[] {
  const sections: MarkdownSection[] = [];
  const lines = markdown.split(/\r?\n/);
  let fence: "`" | "~" | undefined;
  let current: { heading: string; line: number; content: string[] } | undefined;

  const flush = () => {
    if (!current) return;
    sections.push({
      heading: normalizeHeading(current.heading),
      line: current.line,
      content: current.content.join("\n"),
    });
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] as "`" | "~";
      if (!fence) fence = marker;
      else if (fence === marker) fence = undefined;
      continue;
    }
    if (fence) continue;

    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading?.[1]) {
      flush();
      current = { heading: heading[1], line: index + 1, content: [] };
      continue;
    }
    current?.content.push(line);
  }
  flush();
  return sections;
}

export function normalizeHeading(value: string): string {
  return stripHtmlTags(value)
    .replace(/[`*_~]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function hasSubstantiveMarkdown(content: string): boolean {
  const plain = stripHtmlTags(stripHtmlComments(content))
    .replace(/!?(?:\[[^\]]*\])\([^)]*\)/g, "")
    .replace(/[-`*_>#|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length >= 20;
}

/** Remove raw HTML comments without a replace-once sanitizer. */
function stripHtmlComments(value: string): string {
  let output = "";
  let index = 0;
  while (index < value.length) {
    if (!value.startsWith("<!--", index)) {
      output += value[index];
      index += 1;
      continue;
    }
    const end = value.indexOf("-->", index + 4);
    if (end === -1) break;
    index = end + 3;
  }
  return output;
}

/** Treat raw HTML as non-evidence by dropping complete tag-shaped spans. */
function stripHtmlTags(value: string): string {
  let output = "";
  let inTag = false;
  for (const character of value) {
    if (character === "<") {
      inTag = true;
      continue;
    }
    if (character === ">" && inTag) {
      inTag = false;
      output += " ";
      continue;
    }
    if (!inTag) output += character;
  }
  return output;
}
