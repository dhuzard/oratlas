import "server-only";
import {
  claimScopeSchema,
  globalClaimId,
  type ClaimScope as ContractClaimScope,
} from "@oratlas/contracts";
import {
  synthesize,
  type ArchivedReviewDoi,
  type ContradictionEntry,
  type StatementSynthesis,
  type SynthesisCitation,
  type SynthesisStatement,
} from "@oratlas/knowledge";
import { prisma, parseJsonColumn } from "./db";

/**
 * Web adapter for independence-aware synthesis (issue #5). Assembles
 * statements and cited works from readable published versions and runs the
 * deterministic engine. No model is consulted.
 */

async function readableCurrentVersions() {
  const reviews = await prisma.review.findMany({
    where: { status: "published" },
    include: {
      versions: {
        where: { publicState: { in: ["published", "withdrawn"] } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  return reviews
    .map((review) => ({ review, version: review.versions[0] }))
    .filter(
      (
        entry,
      ): entry is {
        review: (typeof reviews)[number];
        version: NonNullable<(typeof entry)["version"]>;
      } => Boolean(entry.version),
    );
}

function parseScope(scopeJson: string | null): ContractClaimScope | undefined {
  if (!scopeJson) return undefined;
  const parsed = claimScopeSchema.safeParse(parseJsonColumn<unknown>(scopeJson, null));
  return parsed.success ? parsed.data : undefined;
}

interface AssembledInput {
  statements: SynthesisStatement[];
  citations: SynthesisCitation[];
  archivedDois: ArchivedReviewDoi[];
  claimTextById: Map<string, { text: string; reviewSlug: string; localClaimId: string }>;
}

async function assemble(): Promise<AssembledInput> {
  const entries = await readableCurrentVersions();
  const versionIds = entries.map((entry) => entry.version.id);
  const slugByVersion = new Map(entries.map((entry) => [entry.version.id, entry.review.slug]));

  const claims = await prisma.claim.findMany({
    where: { reviewVersionId: { in: versionIds } },
    include: {
      evidenceRelations: {
        select: { citationId: true, relationType: true, supportDirection: true },
      },
    },
  });
  const citations = await prisma.citation.findMany({
    where: { reviewVersionId: { in: versionIds } },
  });

  const statements: SynthesisStatement[] = [];
  const claimTextById = new Map<
    string,
    { text: string; reviewSlug: string; localClaimId: string }
  >();
  for (const claim of claims) {
    const reviewSlug = slugByVersion.get(claim.reviewVersionId)!;
    const claimId = globalClaimId(claim.reviewVersionId, claim.localClaimId);
    statements.push({
      claimId,
      reviewSlug,
      reviewVersionId: claim.reviewVersionId,
      localClaimId: claim.localClaimId,
      text: claim.text,
      scope: parseScope(claim.scopeJson),
      evidence: claim.evidenceRelations.map((relation) => ({
        citationId: relation.citationId,
        relationType: relation.relationType,
        supportDirection: relation.supportDirection ?? undefined,
      })),
    });
    claimTextById.set(claimId, { text: claim.text, reviewSlug, localClaimId: claim.localClaimId });
  }

  const synthesisCitations: SynthesisCitation[] = citations.map((citation) => ({
    citationId: citation.id,
    doi: citation.doi ?? undefined,
    pmid: citation.pmid ?? undefined,
    openAlexId: citation.openAlexId ?? undefined,
    title: citation.title ?? undefined,
    year: citation.year ?? undefined,
    datasetIds: parseJsonColumn<string[]>(citation.datasetIdsJson, []),
    derivedFromDois: parseJsonColumn<string[]>(citation.derivedFromJson, []),
    isExample: isExampleCitation(citation.rawCitationJson),
  }));

  // Archived review DOIs (real, non-example) enable circular-citation
  // detection: a citation resolving to one of these points back into Atlas.
  const versionDois = await prisma.reviewVersion.findMany({
    where: { id: { in: versionIds }, isExample: false, versionDoi: { not: null } },
    select: { versionDoi: true, review: { select: { slug: true } } },
  });
  const archivedDois: ArchivedReviewDoi[] = versionDois
    .filter((entry) => entry.versionDoi)
    .map((entry) => ({ doi: entry.versionDoi!, reviewSlug: entry.review.slug }));

  return { statements, citations: synthesisCitations, archivedDois, claimTextById };
}

export interface ContradictionMapRow {
  kind: ContradictionEntry["kind"];
  sharedFamilyCount: number;
  differingScopeFields: string[];
  a: { claimId: string; text: string; passportPath: string };
  b: { claimId: string; text: string; passportPath: string };
}

export interface ContradictionMap {
  reviewCount: number;
  statementCount: number;
  contradictions: ContradictionMapRow[];
  counts: Record<ContradictionEntry["kind"], number>;
}

function passportPath(entry: { reviewVersionId: string; localClaimId: string }): string {
  return `/claims/${entry.reviewVersionId}/${encodeURIComponent(entry.localClaimId)}`;
}

/** Cross-review contradiction map with independence-aware classification. */
export async function getContradictionMap(): Promise<ContradictionMap> {
  const { statements, citations, archivedDois, claimTextById } = await assemble();
  const result = synthesize(statements, citations, archivedDois);
  const versionByClaim = new Map(statements.map((statement) => [statement.claimId, statement]));
  const counts: Record<ContradictionEntry["kind"], number> = {
    "genuine-contradiction": 0,
    "scope-difference": 0,
  };
  const rows: ContradictionMapRow[] = result.contradictions.map((entry) => {
    counts[entry.kind] += 1;
    const a = versionByClaim.get(entry.claimIdA)!;
    const b = versionByClaim.get(entry.claimIdB)!;
    return {
      kind: entry.kind,
      sharedFamilyCount: entry.sharedFamilyCount,
      differingScopeFields: entry.differingScopeFields,
      a: {
        claimId: entry.claimIdA,
        text: claimTextById.get(entry.claimIdA)!.text,
        passportPath: passportPath(a),
      },
      b: {
        claimId: entry.claimIdB,
        text: claimTextById.get(entry.claimIdB)!.text,
        passportPath: passportPath(b),
      },
    };
  });
  const reviewSlugs = new Set(statements.map((statement) => statement.reviewSlug));
  return {
    reviewCount: reviewSlugs.size,
    statementCount: statements.length,
    contradictions: rows,
    counts,
  };
}

export interface ClaimIndependence {
  summary: StatementSynthesis["summary"];
  contradictions: ContradictionMapRow[];
}

/**
 * Independence summary and contradictions for a single claim, for its
 * passport. Computed against the full readable corpus so shared-source and
 * circular-citation signals are visible.
 */
export async function getClaimIndependence(
  reviewVersionId: string,
  localClaimId: string,
): Promise<ClaimIndependence | null> {
  const { statements, citations, archivedDois, claimTextById } = await assemble();
  const claimId = globalClaimId(reviewVersionId, localClaimId);
  const statement = statements.find((entry) => entry.claimId === claimId);
  if (!statement) return null;
  const result = synthesize(statements, citations, archivedDois);
  const summary = result.statements.find((entry) => entry.claimId === claimId)?.summary;
  if (!summary) return null;
  const versionByClaim = new Map(statements.map((entry) => [entry.claimId, entry]));
  const contradictions: ContradictionMapRow[] = result.contradictions
    .filter((entry) => entry.claimIdA === claimId || entry.claimIdB === claimId)
    .map((entry) => {
      const a = versionByClaim.get(entry.claimIdA)!;
      const b = versionByClaim.get(entry.claimIdB)!;
      return {
        kind: entry.kind,
        sharedFamilyCount: entry.sharedFamilyCount,
        differingScopeFields: entry.differingScopeFields,
        a: {
          claimId: entry.claimIdA,
          text: claimTextById.get(entry.claimIdA)!.text,
          passportPath: passportPath(a),
        },
        b: {
          claimId: entry.claimIdB,
          text: claimTextById.get(entry.claimIdB)!.text,
          passportPath: passportPath(b),
        },
      };
    });
  return { summary, contradictions };
}

function isExampleCitation(rawJson: string | null): boolean {
  if (!rawJson) return false;
  try {
    return (JSON.parse(rawJson) as { isExample?: boolean })?.isExample === true;
  } catch {
    return false;
  }
}
