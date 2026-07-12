/**
 * Plain typed inputs for standards exports. Callers (the web app) map their
 * persistence rows into these shapes; this package performs no I/O and never
 * consults the network, so every export can be produced from the archive
 * alone even after the upstream repository disappears.
 */

export interface ExportContributor {
  displayName: string;
  givenName?: string;
  familyName?: string;
  /** Bare ORCID iD (0000-0000-0000-0000), never a URL. */
  orcid?: string;
}

export interface VersionExportInput {
  slug: string;
  versionId: string;
  title: string;
  abstract?: string;
  contributors: ExportContributor[];
  keywords: string[];
  domains: string[];
  reviewType?: string;
  licenseSpdx?: string;
  /** ISO timestamp of acceptance/publication in the archive. */
  publishedAt?: string;
  semanticVersion?: string;
  releaseTag?: string;
  releaseUrl?: string;
  versionDoi?: string;
  conceptDoi?: string;
  zenodoRecordId?: string;
  /**
   * True when the version carries synthetic example identifiers (10.5555/…).
   * Example identifiers are withheld from every machine-actionable identifier
   * field and never rendered as resolvable links; a human-readable note
   * records the omission instead.
   */
  isExample: boolean;
  repositoryUrl: string;
  commitSha: string;
  treeSha?: string;
  /** Absolute canonical Atlas URL of this immutable version. */
  canonicalUrl: string;
}

// The preserved-file descriptor is a public contract shared with the
// preservation manifest; re-exported so exporters and callers agree.
export { type PreservedFileDescriptor } from "@oratlas/contracts";

export interface FeedEntryInput {
  /** Stable entry id (IRI). */
  id: string;
  title: string;
  url: string;
  /** ISO timestamp. */
  updated: string;
  summary?: string;
  authors: string[];
}

export interface FeedInput {
  /** Stable feed id (IRI). */
  id: string;
  title: string;
  siteUrl: string;
  feedUrl: string;
  /** ISO timestamp of the most recent change. */
  updated: string;
  entries: FeedEntryInput[];
}

export const EXAMPLE_IDENTIFIER_NOTE =
  "Version and concept DOIs on this record are synthetic examples (10.5555/…) and are " +
  "not resolvable; they are withheld from identifier fields.";
