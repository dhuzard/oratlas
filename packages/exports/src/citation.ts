import { EXAMPLE_IDENTIFIER_NOTE, type VersionExportInput } from "./types.js";

/**
 * Citation exports (CSL-JSON, BibTeX, RIS) for one immutable version.
 * Example identifiers are withheld from DOI fields and replaced by a note —
 * a synthetic 10.5555/… DOI must never flow into reference managers as a
 * resolvable identifier.
 */

interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}

export interface CslItem {
  id: string;
  type: "article";
  title: string;
  abstract?: string;
  author: CslName[];
  issued?: { "date-parts": number[][] };
  publisher: string;
  URL: string;
  version?: string;
  DOI?: string;
  keyword?: string;
  note?: string;
}

function cslName(contributor: VersionExportInput["contributors"][number]): CslName {
  if (contributor.familyName) {
    return { family: contributor.familyName, given: contributor.givenName };
  }
  return { literal: contributor.displayName };
}

function issuedDateParts(publishedAt?: string): { "date-parts": number[][] } | undefined {
  if (!publishedAt) return undefined;
  const date = new Date(publishedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return {
    "date-parts": [[date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]],
  };
}

export function cslJson(input: VersionExportInput): CslItem {
  const item: CslItem = {
    id: `${input.slug}:${input.versionId}`,
    type: "article",
    title: input.title,
    abstract: input.abstract,
    author: input.contributors.map(cslName),
    issued: issuedDateParts(input.publishedAt),
    publisher: "Open Review Atlas",
    URL: input.canonicalUrl,
    version: input.semanticVersion,
    keyword: input.keywords.length > 0 ? input.keywords.join(", ") : undefined,
  };
  if (input.versionDoi && !input.isExample) item.DOI = input.versionDoi;
  if (input.isExample && (input.versionDoi || input.conceptDoi)) {
    item.note = EXAMPLE_IDENTIFIER_NOTE;
  }
  return item;
}

/**
 * Escape BibTeX special characters in a field value. A single pass keeps the
 * markup inserted for one character from being re-escaped by the next rule.
 */
export function bibtexEscape(value: string): string {
  return value.replace(/[\\{}&%$#_~^]/g, (char) => {
    switch (char) {
      case "\\":
        return "\\textbackslash{}";
      case "~":
        return "\\textasciitilde{}";
      case "^":
        return "\\textasciicircum{}";
      default:
        return `\\${char}`;
    }
  });
}

function bibtexKey(input: VersionExportInput): string {
  const year = input.publishedAt ? new Date(input.publishedAt).getUTCFullYear() : undefined;
  const base = `${input.slug}${year ? `-${year}` : ""}`;
  return base.replace(/[^A-Za-z0-9-]/g, "-");
}

export function bibtex(input: VersionExportInput): string {
  const fields: Array<[string, string]> = [["title", bibtexEscape(input.title)]];
  if (input.contributors.length > 0) {
    fields.push([
      "author",
      input.contributors
        .map((contributor) =>
          contributor.familyName
            ? `${bibtexEscape(contributor.familyName)}, ${bibtexEscape(contributor.givenName ?? "")}`.replace(
                /, $/,
                "",
              )
            : `{${bibtexEscape(contributor.displayName)}}`,
        )
        .join(" and "),
    ]);
  }
  if (input.publishedAt) {
    const date = new Date(input.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      fields.push(["year", String(date.getUTCFullYear())]);
      fields.push(["month", String(date.getUTCMonth() + 1)]);
    }
  }
  fields.push(["howpublished", `Open Review Atlas, \\url{${input.canonicalUrl}}`]);
  fields.push(["url", input.canonicalUrl]);
  if (input.semanticVersion) fields.push(["version", bibtexEscape(input.semanticVersion)]);
  if (input.versionDoi && !input.isExample) fields.push(["doi", input.versionDoi]);
  const notes = [`Source repository: ${input.repositoryUrl} at commit ${input.commitSha}.`];
  if (input.isExample && (input.versionDoi || input.conceptDoi)) {
    notes.push(EXAMPLE_IDENTIFIER_NOTE);
  }
  fields.push(["note", bibtexEscape(notes.join(" "))]);

  const body = fields.map(([name, value]) => `  ${name} = {${value}}`).join(",\n");
  return `@misc{${bibtexKey(input)},\n${body}\n}\n`;
}

/** Strip CR/LF so repository text cannot forge extra RIS tags. */
function risValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export function ris(input: VersionExportInput): string {
  const lines: string[] = ["TY  - GEN"];
  lines.push(`TI  - ${risValue(input.title)}`);
  for (const contributor of input.contributors) {
    const name = contributor.familyName
      ? `${contributor.familyName}, ${contributor.givenName ?? ""}`.replace(/, $/, "")
      : contributor.displayName;
    lines.push(`AU  - ${risValue(name)}`);
  }
  if (input.abstract) lines.push(`AB  - ${risValue(input.abstract)}`);
  if (input.publishedAt) {
    const date = new Date(input.publishedAt);
    if (!Number.isNaN(date.getTime())) {
      lines.push(
        `PY  - ${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${String(
          date.getUTCDate(),
        ).padStart(2, "0")}`,
      );
    }
  }
  lines.push("PB  - Open Review Atlas");
  lines.push(`UR  - ${risValue(input.canonicalUrl)}`);
  for (const keyword of input.keywords) lines.push(`KW  - ${risValue(keyword)}`);
  if (input.versionDoi && !input.isExample) lines.push(`DO  - ${risValue(input.versionDoi)}`);
  const notes = [`Source repository: ${input.repositoryUrl} at commit ${input.commitSha}.`];
  if (input.isExample && (input.versionDoi || input.conceptDoi)) {
    notes.push(EXAMPLE_IDENTIFIER_NOTE);
  }
  lines.push(`N1  - ${risValue(notes.join(" "))}`);
  lines.push("ER  - ");
  return lines.join("\r\n") + "\r\n";
}
