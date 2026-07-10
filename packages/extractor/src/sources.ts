import { parse as parseYaml } from "yaml";
import {
  reviewManifestSchema,
  type ExtractedPerson,
  type ReviewManifest,
} from "@oratlas/contracts";

/**
 * Deterministic parsers for each metadata source file. Each returns a partial
 * of normalized fields plus any warnings; none throws on malformed input.
 */

export interface ParsedSource {
  title?: string;
  abstract?: string;
  authors?: ExtractedPerson[];
  keywords?: string[];
  domains?: string[];
  license?: string;
  repositoryUrl?: string;
  publishedReviewUrl?: string;
  releaseTag?: string;
  versionDoi?: string;
  conceptDoi?: string;
  zenodoRecordId?: string;
  reviewType?: string;
  language?: string;
  contact?: string;
  warnings: string[];
}

function safeYaml(content: string): unknown {
  try {
    return parseYaml(content);
  } catch {
    return undefined;
  }
}

function safeJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return undefined;
  }
}

function orcidFromUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = /(\d{4}-\d{4}-\d{4}-\d{3}[\dX])/.exec(value);
  return m ? m[1] : undefined;
}

/** review-manifest.json — highest priority, strictly validated. */
export function parseManifest(content: string): {
  manifest?: ReviewManifest;
  parsed: ParsedSource;
} {
  const json = safeJson(content);
  const result = reviewManifestSchema.safeParse(json);
  if (!result.success) {
    return {
      parsed: {
        warnings: ["review-manifest.json present but invalid; ignored for extraction."],
      },
    };
  }
  const m = result.data;
  const authors: ExtractedPerson[] = (m.contributors ?? []).map((c) => ({
    displayName: c.displayName,
    givenName: c.givenName,
    familyName: c.familyName,
    orcid: c.orcid,
    githubLogin: c.githubLogin,
    roles: c.roles ?? [],
  }));
  return {
    manifest: m,
    parsed: {
      title: m.review.title,
      abstract: m.review.abstract,
      keywords: m.review.keywords,
      domains: m.review.domains,
      license: m.review.license,
      reviewType: m.review.reviewType,
      language: m.review.language,
      repositoryUrl: m.repository.url,
      releaseTag: m.repository.releaseTag,
      publishedReviewUrl: m.publication?.reviewUrl,
      versionDoi: m.publication?.versionDoi,
      conceptDoi: m.publication?.conceptDoi,
      zenodoRecordId: m.publication?.zenodoRecordId,
      contact: m.contact?.name,
      authors: authors.length > 0 ? authors : undefined,
      warnings: [],
    },
  };
}

/** CITATION.cff (YAML). */
export function parseCitationCff(content: string): ParsedSource {
  const doc = safeYaml(content);
  if (!doc || typeof doc !== "object") {
    return { warnings: ["CITATION.cff present but could not be parsed."] };
  }
  const d = doc as Record<string, unknown>;
  const authors: ExtractedPerson[] = [];
  if (Array.isArray(d.authors)) {
    for (const a of d.authors as Array<Record<string, unknown>>) {
      const given = typeof a["given-names"] === "string" ? a["given-names"] : undefined;
      const family = typeof a["family-names"] === "string" ? a["family-names"] : undefined;
      const name =
        typeof a.name === "string" ? a.name : [given, family].filter(Boolean).join(" ").trim();
      if (!name) continue;
      authors.push({
        displayName: name,
        givenName: given,
        familyName: family,
        orcid: orcidFromUrl(a.orcid),
        roles: [],
      });
    }
  }
  return {
    title: typeof d.title === "string" ? d.title : undefined,
    abstract: typeof d.abstract === "string" ? d.abstract : undefined,
    license: typeof d.license === "string" ? d.license : undefined,
    repositoryUrl:
      typeof d["repository-code"] === "string" ? (d["repository-code"] as string) : undefined,
    keywords: Array.isArray(d.keywords)
      ? (d.keywords as unknown[]).filter((k): k is string => typeof k === "string")
      : undefined,
    authors: authors.length > 0 ? authors : undefined,
    versionDoi: typeof d.doi === "string" ? d.doi : undefined,
    warnings: [],
  };
}

/** .zenodo.json */
export function parseZenodoJson(content: string): ParsedSource {
  const json = safeJson(content);
  if (!json || typeof json !== "object") {
    return { warnings: [".zenodo.json present but could not be parsed."] };
  }
  const d = json as Record<string, unknown>;
  const authors: ExtractedPerson[] = [];
  if (Array.isArray(d.creators)) {
    for (const c of d.creators as Array<Record<string, unknown>>) {
      if (typeof c.name !== "string") continue;
      authors.push({
        displayName: c.name,
        orcid: orcidFromUrl(c.orcid),
        roles: [],
      });
    }
  }
  return {
    title: typeof d.title === "string" ? d.title : undefined,
    abstract: typeof d.description === "string" ? d.description : undefined,
    license:
      typeof d.license === "string"
        ? d.license
        : d.license && typeof d.license === "object"
          ? ((d.license as Record<string, unknown>).id as string | undefined)
          : undefined,
    keywords: Array.isArray(d.keywords)
      ? (d.keywords as unknown[]).filter((k): k is string => typeof k === "string")
      : undefined,
    authors: authors.length > 0 ? authors : undefined,
    warnings: [],
  };
}

/** codemeta.json */
export function parseCodemeta(content: string): ParsedSource {
  const json = safeJson(content);
  if (!json || typeof json !== "object") {
    return { warnings: ["codemeta.json present but could not be parsed."] };
  }
  const d = json as Record<string, unknown>;
  const authors: ExtractedPerson[] = [];
  if (Array.isArray(d.author)) {
    for (const a of d.author as Array<Record<string, unknown>>) {
      const given = typeof a.givenName === "string" ? a.givenName : undefined;
      const family = typeof a.familyName === "string" ? a.familyName : undefined;
      const name = [given, family].filter(Boolean).join(" ").trim();
      if (!name) continue;
      authors.push({
        displayName: name,
        givenName: given,
        familyName: family,
        orcid: orcidFromUrl(a["@id"] ?? a.identifier),
        roles: [],
      });
    }
  }
  return {
    title: typeof d.name === "string" ? d.name : undefined,
    abstract: typeof d.description === "string" ? d.description : undefined,
    license: typeof d.license === "string" ? d.license : undefined,
    keywords: Array.isArray(d.keywords)
      ? (d.keywords as unknown[]).filter((k): k is string => typeof k === "string")
      : undefined,
    authors: authors.length > 0 ? authors : undefined,
    warnings: [],
  };
}

/** myst.yml / myst.yaml project configuration. */
export function parseMystConfig(content: string): ParsedSource {
  const doc = safeYaml(content);
  if (!doc || typeof doc !== "object") {
    return { warnings: ["MyST config present but could not be parsed."] };
  }
  const project = ((doc as Record<string, unknown>).project ?? {}) as Record<string, unknown>;
  return {
    title: typeof project.title === "string" ? project.title : undefined,
    abstract: typeof project.description === "string" ? project.description : undefined,
    license:
      typeof project.license === "string"
        ? project.license
        : project.license && typeof project.license === "object"
          ? ((project.license as Record<string, unknown>).content as string | undefined)
          : undefined,
    keywords: Array.isArray(project.keywords)
      ? (project.keywords as unknown[]).filter((k): k is string => typeof k === "string")
      : undefined,
    repositoryUrl: typeof project.github === "string" ? project.github : undefined,
    warnings: [],
  };
}

/** README front matter + first heading heuristic (lowest priority). */
export function parseReadme(content: string): ParsedSource {
  const warnings: string[] = [];
  let title: string | undefined;
  const headingMatch = /^#\s+(.+)$/m.exec(content);
  if (headingMatch) title = headingMatch[1]?.trim();

  // Abstract: first non-empty paragraph after the first heading.
  let abstract: string | undefined;
  const afterHeading = headingMatch
    ? content.slice((headingMatch.index ?? 0) + headingMatch[0].length)
    : content;
  const para = afterHeading
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p.length > 40 && !p.startsWith("#") && !p.startsWith("!["));
  if (para) abstract = para.replace(/\s+/g, " ").slice(0, 1000);

  if (!title) warnings.push("README has no top-level heading; title not extracted from README.");
  return { title, abstract, warnings };
}
