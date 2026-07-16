import "server-only";
import {
  canonicalJson,
  isExactCommitSha,
  isSafeRepoRelativePath,
  preservedFilesSchema,
} from "@oratlas/contracts";
import { prisma } from "./db";
import { sha256 } from "./hash";
import { isReadablePublicState } from "./review-lifecycle";

export interface DiffChange {
  key: string;
  beforeChecksum: string;
  afterChecksum: string;
}

export interface DiffSection {
  beforeChecksum: string;
  afterChecksum: string;
  added: string[];
  removed: string[];
  changed: DiffChange[];
}

export interface ReviewVersionDiff {
  schemaVersion: "1.0.0";
  reviewSlug: string;
  from: { versionId: string; commitSha: string; checksum: string };
  to: { versionId: string; commitSha: string; checksum: string };
  sections: {
    assets: DiffSection;
    metadata: DiffSection;
    claims: DiffSection;
    citations: DiffSection;
  };
  checksum: string;
}

type CanonicalRecords = Record<string, unknown>;

export interface CanonicalEvidenceEdge {
  citationLocalId: string;
  relationType: string;
  supportDirection: string | null;
  sourceLocation: string | null;
}

/** Logical scholarly edge order; database-generated ids are never inputs. */
export function canonicalEvidenceEdges(edges: CanonicalEvidenceEdge[]): CanonicalEvidenceEdge[] {
  return [...edges].sort((left, right) => {
    const leftKey = canonicalJson([
      left.citationLocalId,
      left.relationType,
      left.supportDirection,
      left.sourceLocation,
    ]);
    const rightKey = canonicalJson([
      right.citationLocalId,
      right.relationType,
      right.supportDirection,
      right.sourceLocation,
    ]);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function checksum(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function diffCanonicalRecords(
  before: CanonicalRecords,
  after: CanonicalRecords,
): DiffSection {
  const beforeKeys = Object.keys(before).sort((a, b) => a.localeCompare(b));
  const afterKeys = Object.keys(after).sort((a, b) => a.localeCompare(b));
  const beforeSet = new Set(beforeKeys);
  const afterSet = new Set(afterKeys);
  const added = afterKeys.filter((key) => !beforeSet.has(key));
  const removed = beforeKeys.filter((key) => !afterSet.has(key));
  const changed: DiffChange[] = [];
  for (const key of beforeKeys) {
    if (!afterSet.has(key)) continue;
    const beforeChecksum = checksum(before[key]);
    const afterChecksum = checksum(after[key]);
    if (beforeChecksum !== afterChecksum) changed.push({ key, beforeChecksum, afterChecksum });
  }
  return {
    beforeChecksum: checksum(before),
    afterChecksum: checksum(after),
    added,
    removed,
    changed,
  };
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function assetRecords(value: string | null): CanonicalRecords | null {
  if (!value) return {};
  const parsed = preservedFilesSchema.safeParse(parseJsonObject(value));
  if (!parsed.success) return null;
  const records: CanonicalRecords = {};
  for (const path of Object.keys(parsed.data).sort((a, b) => a.localeCompare(b))) {
    if (!isSafeRepoRelativePath(path)) return null;
    const file = parsed.data[path]!;
    records[path] = {
      size: file.size,
      truncated: file.truncated,
      contentSha256: sha256(file.content),
    };
  }
  return records;
}

async function loadDiffVersion(slug: string, versionId: string) {
  return prisma.reviewVersion.findFirst({
    where: { id: versionId, review: { slug, status: "published" } },
    select: {
      id: true,
      publicState: true,
      metadataJson: true,
      snapshot: {
        select: { commitSha: true, preservedFilesJson: true },
      },
      claims: {
        orderBy: { localClaimId: "asc" },
        select: {
          localClaimId: true,
          text: true,
          section: true,
          anchor: true,
          claimType: true,
          qualification: true,
          evidenceRelations: {
            select: {
              relationType: true,
              supportDirection: true,
              sourceLocation: true,
              citation: { select: { localCitationId: true } },
            },
          },
        },
      },
      citations: {
        orderBy: { localCitationId: "asc" },
        select: {
          localCitationId: true,
          doi: true,
          pmid: true,
          openAlexId: true,
          title: true,
          authorsJson: true,
          year: true,
          source: true,
          url: true,
        },
      },
    },
  });
}

type DiffVersion = NonNullable<Awaited<ReturnType<typeof loadDiffVersion>>>;

function canonicalVersion(version: DiffVersion) {
  if (
    !isReadablePublicState(version.publicState) ||
    !version.snapshot ||
    !isExactCommitSha(version.snapshot.commitSha)
  ) {
    return null;
  }
  const metadata = parseJsonObject(version.metadataJson);
  const assets = assetRecords(version.snapshot.preservedFilesJson);
  if (!metadata || !assets) return null;
  const claims: CanonicalRecords = {};
  for (const claim of version.claims) {
    claims[claim.localClaimId] = {
      text: claim.text,
      section: claim.section,
      sourceAnchor: claim.anchor,
      claimType: claim.claimType,
      qualification: claim.qualification,
      evidence: canonicalEvidenceEdges(
        claim.evidenceRelations.map((relation) => ({
          citationLocalId: relation.citation.localCitationId,
          relationType: relation.relationType,
          supportDirection: relation.supportDirection,
          sourceLocation: relation.sourceLocation,
        })),
      ),
    };
  }
  const citations: CanonicalRecords = {};
  for (const citation of version.citations) {
    const authors = parseJsonObject(`{"authors":${citation.authorsJson}}`);
    if (!authors) return null;
    citations[citation.localCitationId] = {
      doi: citation.doi,
      pmid: citation.pmid,
      openAlexId: citation.openAlexId,
      title: citation.title,
      authors: authors.authors,
      year: citation.year,
      source: citation.source,
      url: citation.url,
    };
  }
  return { metadata, assets, claims, citations };
}

/** Canonical, deterministic diff; tombstoned/malformed/non-exact versions fail closed. */
export async function getReviewVersionDiff(
  slug: string,
  fromVersionId: string,
  toVersionId: string,
): Promise<ReviewVersionDiff | null> {
  if (fromVersionId === toVersionId) return null;
  const [from, to] = await Promise.all([
    loadDiffVersion(slug, fromVersionId),
    loadDiffVersion(slug, toVersionId),
  ]);
  if (!from || !to) return null;
  const before = canonicalVersion(from);
  const after = canonicalVersion(to);
  if (!before || !after) return null;

  const sections = {
    assets: diffCanonicalRecords(before.assets, after.assets),
    metadata: diffCanonicalRecords(before.metadata, after.metadata),
    claims: diffCanonicalRecords(before.claims, after.claims),
    citations: diffCanonicalRecords(before.citations, after.citations),
  };
  const base = {
    schemaVersion: "1.0.0" as const,
    reviewSlug: slug,
    from: {
      versionId: from.id,
      commitSha: from.snapshot!.commitSha,
      checksum: checksum(before),
    },
    to: {
      versionId: to.id,
      commitSha: to.snapshot!.commitSha,
      checksum: checksum(after),
    },
    sections,
  };
  return { ...base, checksum: checksum(base) };
}
