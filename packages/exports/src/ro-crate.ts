import { swhidForDirectory, swhidForRevision } from "./swhid.js";
import {
  EXAMPLE_IDENTIFIER_NOTE,
  type PreservedFileDescriptor,
  type VersionExportInput,
} from "./types.js";

/**
 * RO-Crate 1.1 metadata document describing the preserved package of one
 * immutable version: the archived repository files (checksums included), the
 * exact source commit/tree, license and contributors. Pure data mapping —
 * consumers fetch file bytes through the preservation endpoints.
 */

export interface RoCrateInput {
  version: VersionExportInput;
  files: PreservedFileDescriptor[];
  /** SHA-256 over the normalized snapshot payload. */
  snapshotContentHash?: string;
  /** SHA-256 of the exact accepted inspection capture. */
  capturePayloadHash?: string;
}

type JsonLdEntity = Record<string, unknown>;

/**
 * Data-entity @ids must be valid URI references (RO-Crate 1.1); preserved
 * repository paths may contain spaces, "#" or "?", so each segment is
 * percent-encoded while "/" separators are kept.
 */
function fileEntityId(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function roCrate(input: RoCrateInput): { "@context": string; "@graph": JsonLdEntity[] } {
  const { version, files } = input;
  const graph: JsonLdEntity[] = [];

  graph.push({
    "@id": "ro-crate-metadata.json",
    "@type": "CreativeWork",
    conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" },
    about: { "@id": "./" },
    mentions: { "@id": "#oratlas-platform" },
  });

  const identifiers: string[] = [version.canonicalUrl];
  if (version.versionDoi && !version.isExample) {
    identifiers.push(`https://doi.org/${version.versionDoi}`);
  }
  const revisionSwhid = swhidForRevision(version.commitSha);
  const directorySwhid = version.treeSha ? swhidForDirectory(version.treeSha) : undefined;
  if (revisionSwhid) identifiers.push(revisionSwhid);
  if (directorySwhid) identifiers.push(directorySwhid);

  const root: JsonLdEntity = {
    "@id": "./",
    "@type": "Dataset",
    name: version.title,
    identifier: identifiers,
    url: version.canonicalUrl,
    isBasedOn: version.repositoryUrl,
    publisher: { "@id": "#open-review-atlas" },
    hasPart: files.map((file) => ({ "@id": fileEntityId(file.path) })),
    author: version.contributors.map((_, index) => ({ "@id": `#author-${index}` })),
  };
  if (version.abstract) root.description = version.abstract;
  if (version.publishedAt) root.datePublished = version.publishedAt;
  if (version.licenseSpdx) {
    root.license = { "@id": `https://spdx.org/licenses/${version.licenseSpdx}` };
  }
  if (version.semanticVersion) root.version = version.semanticVersion;
  if (version.keywords.length > 0) root.keywords = version.keywords.join(", ");
  const disambiguations: string[] = [
    `Preserved from ${version.repositoryUrl} at commit ${version.commitSha}.`,
  ];
  if (input.snapshotContentHash) {
    disambiguations.push(`Snapshot content hash (SHA-256): ${input.snapshotContentHash}.`);
  }
  if (input.capturePayloadHash) {
    disambiguations.push(`Accepted capture hash (SHA-256): ${input.capturePayloadHash}.`);
  }
  if (version.isExample && (version.versionDoi || version.conceptDoi)) {
    disambiguations.push(EXAMPLE_IDENTIFIER_NOTE);
  }
  root.disambiguatingDescription = disambiguations.join(" ");
  graph.push(root);

  graph.push({
    "@id": "#open-review-atlas",
    "@type": "Organization",
    name: "Open Review Atlas",
  });

  graph.push({
    "@id": "#oratlas-platform",
    "@type": "SoftwareApplication",
    name: "Open Review Atlas",
    softwareVersion: version.platformVersion,
  });

  version.contributors.forEach((contributor, index) => {
    const person: JsonLdEntity = {
      "@id": `#author-${index}`,
      "@type": "Person",
      name: contributor.displayName,
    };
    if (contributor.givenName) person.givenName = contributor.givenName;
    if (contributor.familyName) person.familyName = contributor.familyName;
    if (contributor.orcid && !version.isExample) {
      person.identifier = `https://orcid.org/${contributor.orcid}`;
    }
    graph.push(person);
  });

  for (const file of files) {
    const entity: JsonLdEntity = {
      "@id": fileEntityId(file.path),
      "@type": "File",
      name: file.path,
      contentSize: String(file.size),
    };
    if (file.sha256) entity.sha256 = file.sha256;
    if (file.truncated) {
      entity.disambiguatingDescription =
        "Preserved content was truncated at capture limits; the checksum covers the preserved bytes.";
    }
    graph.push(entity);
  }

  return { "@context": "https://w3id.org/ro/crate/1.1/context", "@graph": graph };
}
