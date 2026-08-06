type CanonicalLabelAlias = {
  scheme?: string | null;
  value?: string | null;
};

export interface CanonicalLabelInput {
  kind: string;
  localNodeId: string;
  title?: string | null;
  abstract?: string | null;
  text?: string | null;
  payload?: unknown;
  aliases?: readonly CanonicalLabelAlias[];
}

/**
 * Derive compact human-facing copy from canonical node content.
 *
 * Work versions may preserve a citation occurrence as JSON in `text`. That is
 * canonical source material, not a display title, so it must never leak into
 * Explore labels. Prefer a scholarly identifier when no title was supplied.
 */
export function canonicalNodeDisplayLabel(node: CanonicalLabelInput): string {
  const title = nonEmptyString(node.title);
  if (title) return title;

  const statement = propertyString(node.payload, "statement");
  if (statement) return statement;

  if (node.kind === "work") return workDisplayLabel(node);

  const text = nonEmptyString(node.text);
  if (text) return text;

  const abstract = nonEmptyString(node.abstract);
  if (abstract) return abstract;

  const alias = node.aliases?.find(({ value }) => nonEmptyString(value));
  if (alias?.value) return formatIdentifier(alias.scheme, alias.value);

  return `${titleCase(node.kind)} ${node.localNodeId}`;
}

function workDisplayLabel(node: CanonicalLabelInput): string {
  const doi = propertyString(node.payload, "doi") ?? aliasValue(node.aliases, "doi");
  if (doi) return `DOI ${doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")}`;

  const pmid = propertyString(node.payload, "pmid") ?? aliasValue(node.aliases, "pmid");
  if (pmid) return `PubMed ${pmid.replace(/^pmid:\s*/i, "")}`;

  const openAlex =
    propertyString(node.payload, "openAlexId") ?? aliasValue(node.aliases, "openalex");
  if (openAlex) return `OpenAlex ${openAlex.replace(/^https?:\/\/openalex\.org\//i, "")}`;

  const citationId = propertyString(node.payload, "id");
  if (citationId) return `Evidence record ${citationId}`;

  return `Evidence record ${node.localNodeId}`;
}

function aliasValue(aliases: CanonicalLabelInput["aliases"], scheme: string): string | undefined {
  return nonEmptyString(aliases?.find((alias) => alias.scheme === scheme)?.value);
}

function propertyString(value: unknown, property: string): string | undefined {
  if (!value || typeof value !== "object" || !(property in value)) return undefined;
  return nonEmptyString((value as Record<string, unknown>)[property]);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatIdentifier(scheme: string | null | undefined, value: string): string {
  if (scheme === "doi") return `DOI ${value}`;
  if (scheme === "pmid") return `PubMed ${value}`;
  if (scheme === "openalex") return `OpenAlex ${value}`;
  return value;
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
