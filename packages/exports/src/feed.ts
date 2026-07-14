import { type FeedInput } from "./types.js";
import { escapeXml } from "./xml.js";

/** Atom 1.0 feed of recently accepted reviews. All text is escaped. */
export function atomFeed(input: FeedInput): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<feed xmlns="http://www.w3.org/2005/Atom">`);
  lines.push(`  <id>${escapeXml(input.id)}</id>`);
  lines.push(`  <title>${escapeXml(input.title)}</title>`);
  lines.push(`  <updated>${escapeXml(input.updated)}</updated>`);
  lines.push(`  <link rel="alternate" href="${escapeXml(input.siteUrl)}"/>`);
  lines.push(`  <link rel="self" href="${escapeXml(input.feedUrl)}"/>`);
  for (const entry of input.entries) {
    lines.push(`  <entry>`);
    lines.push(`    <id>${escapeXml(entry.id)}</id>`);
    lines.push(`    <title>${escapeXml(entry.title)}</title>`);
    lines.push(`    <updated>${escapeXml(entry.updated)}</updated>`);
    lines.push(`    <link rel="alternate" href="${escapeXml(entry.url)}"/>`);
    for (const author of entry.authors) {
      lines.push(`    <author><name>${escapeXml(author)}</name></author>`);
    }
    if (entry.authors.length === 0) {
      lines.push(`    <author><name>Open Review Atlas</name></author>`);
    }
    if (entry.summary) {
      lines.push(`    <summary>${escapeXml(entry.summary)}</summary>`);
    }
    lines.push(`  </entry>`);
  }
  lines.push(`</feed>`);
  return lines.join("\n") + "\n";
}
