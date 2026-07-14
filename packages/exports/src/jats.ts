import { EXAMPLE_IDENTIFIER_NOTE, type VersionExportInput } from "./types.js";
import { escapeXml } from "./xml.js";

/**
 * Minimal JATS 1.3 front-matter document for one immutable version. Every
 * value derived from repository content passes through escapeXml, so
 * untrusted text can never introduce markup.
 */
export function jats(input: VersionExportInput): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<article xmlns:xlink="http://www.w3.org/1999/xlink" dtd-version="1.3" article-type="review-article">`,
  );
  lines.push(`  <front>`);
  lines.push(`    <journal-meta>`);
  lines.push(`      <journal-title-group>`);
  lines.push(`        <journal-title>Open Review Atlas</journal-title>`);
  lines.push(`      </journal-title-group>`);
  lines.push(`    </journal-meta>`);
  lines.push(`    <article-meta>`);
  if (input.versionDoi && !input.isExample) {
    lines.push(`      <article-id pub-id-type="doi">${escapeXml(input.versionDoi)}</article-id>`);
  }
  lines.push(`      <title-group>`);
  lines.push(`        <article-title>${escapeXml(input.title)}</article-title>`);
  lines.push(`      </title-group>`);
  if (input.contributors.length > 0) {
    lines.push(`      <contrib-group>`);
    for (const contributor of input.contributors) {
      lines.push(`        <contrib contrib-type="author">`);
      if (contributor.orcid && !input.isExample) {
        lines.push(
          `          <contrib-id contrib-id-type="orcid">https://orcid.org/${escapeXml(contributor.orcid)}</contrib-id>`,
        );
      }
      if (contributor.familyName) {
        lines.push(`          <name>`);
        lines.push(`            <surname>${escapeXml(contributor.familyName)}</surname>`);
        if (contributor.givenName) {
          lines.push(`            <given-names>${escapeXml(contributor.givenName)}</given-names>`);
        }
        lines.push(`          </name>`);
      } else {
        lines.push(`          <string-name>${escapeXml(contributor.displayName)}</string-name>`);
      }
      lines.push(`        </contrib>`);
    }
    lines.push(`      </contrib-group>`);
  }
  if (input.publishedAt) {
    const date = new Date(input.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      lines.push(`      <pub-date date-type="pub" publication-format="electronic">`);
      lines.push(`        <day>${String(date.getUTCDate()).padStart(2, "0")}</day>`);
      lines.push(`        <month>${String(date.getUTCMonth() + 1).padStart(2, "0")}</month>`);
      lines.push(`        <year>${date.getUTCFullYear()}</year>`);
      lines.push(`      </pub-date>`);
    }
  }
  if (input.licenseSpdx) {
    lines.push(`      <permissions>`);
    lines.push(`        <license>`);
    lines.push(`          <license-p>${escapeXml(input.licenseSpdx)}</license-p>`);
    lines.push(`        </license>`);
    lines.push(`      </permissions>`);
  }
  lines.push(`      <self-uri xlink:href="${escapeXml(input.canonicalUrl)}"/>`);
  if (input.abstract) {
    lines.push(`      <abstract>`);
    lines.push(`        <p>${escapeXml(input.abstract)}</p>`);
    lines.push(`      </abstract>`);
  }
  if (input.keywords.length > 0) {
    lines.push(`      <kwd-group kwd-group-type="author">`);
    for (const keyword of input.keywords) {
      lines.push(`        <kwd>${escapeXml(keyword)}</kwd>`);
    }
    lines.push(`      </kwd-group>`);
  }
  lines.push(`      <custom-meta-group>`);
  const customMeta: Array<[string, string]> = [
    ["source-repository", input.repositoryUrl],
    ["source-commit", input.commitSha],
  ];
  if (input.treeSha) customMeta.push(["source-tree", input.treeSha]);
  if (input.releaseTag) customMeta.push(["source-release-tag", input.releaseTag]);
  if (input.semanticVersion) customMeta.push(["version", input.semanticVersion]);
  if (input.isExample && (input.versionDoi || input.conceptDoi)) {
    customMeta.push(["identifier-note", EXAMPLE_IDENTIFIER_NOTE]);
  }
  for (const [name, value] of customMeta) {
    lines.push(`        <custom-meta>`);
    lines.push(`          <meta-name>${escapeXml(name)}</meta-name>`);
    lines.push(`          <meta-value>${escapeXml(value)}</meta-value>`);
    lines.push(`        </custom-meta>`);
  }
  lines.push(`      </custom-meta-group>`);
  lines.push(`    </article-meta>`);
  lines.push(`  </front>`);
  lines.push(`</article>`);
  return lines.join("\n") + "\n";
}
