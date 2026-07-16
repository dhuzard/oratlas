import { type PublicNodeDetail } from "@oratlas/contracts";

/** Build schema.org metadata from validated public DTOs only. */
export function nodeJsonLd(node: PublicNodeDetail, canonicalUrl: string): Record<string, unknown> {
  const version = node.version;
  const type =
    node.kind === "dataset"
      ? "Dataset"
      : node.kind === "code"
        ? "SoftwareSourceCode"
        : "CreativeWork";
  const identifiers = version.identifiers
    .filter((identifier) => !identifier.isExample)
    .map((identifier) => ({
      "@type": "PropertyValue",
      propertyID: `DOI (${identifier.role.replace(/-doi$/, "")})`,
      value: identifier.value,
      url: `https://doi.org/${identifier.value}`,
    }));
  const result: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": type,
    "@id": canonicalUrl,
    url: canonicalUrl,
    name: version.title,
    description: version.abstract ?? version.text,
    license: version.license,
    identifier: identifiers.length > 0 ? identifiers : undefined,
    author: version.contributors.map((contributor) => ({
      "@type": "Person",
      name: contributor.displayName,
      identifier: contributor.orcid ? `https://orcid.org/${contributor.orcid}` : undefined,
    })),
    isBasedOn: node.repository.url,
    version: version.commitSha,
    dateCreated: version.createdAt,
  };
  if (version.kind === "dataset") {
    result.encodingFormat = version.payload.format;
    result.contentSize = `${version.payload.sizeBytes} bytes`;
  }
  if (version.kind === "code") {
    result.programmingLanguage = version.payload.language;
    result.codeRepository = node.repository.url;
    result.softwareVersion = version.payload.releaseRef;
  }
  return stripUndefined(result);
}

function stripUndefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
