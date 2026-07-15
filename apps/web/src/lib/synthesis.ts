import "server-only";
import {
  canonicalJson,
  claimScopeSchema,
  globalClaimId,
  type ClaimScope as ContractClaimScope,
} from "@oratlas/contracts";
import { type Prisma } from "@oratlas/db";
import {
  rankReplicationGaps,
  synthesize,
  type ArchivedReviewDoi,
  type ContradictionEntry,
  type StatementSynthesis,
  type SynthesisCitation,
  type SynthesisStatement,
  type RankedReplicationGap,
} from "@oratlas/knowledge";
import { prisma, parseJsonColumn } from "./db";
import { sha256 } from "./hash";

/**
 * Web adapter for independence-aware synthesis (issue #5). Assembles
 * statements and cited works from readable published versions and runs the
 * deterministic engine. No model is consulted.
 */

type CorpusReader = Pick<
  Prisma.TransactionClient,
  "review" | "claim" | "citation" | "reviewVersion"
>;

async function readableCurrentVersions(reader: CorpusReader) {
  const reviews = await reader.review.findMany({
    where: { status: "published" },
    include: {
      versions: {
        where: { publicState: { in: ["published", "withdrawn"] } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

async function assemble(reader: CorpusReader = prisma): Promise<AssembledInput> {
  const entries = await readableCurrentVersions(reader);
  const versionIds = entries.map((entry) => entry.version.id);
  const slugByVersion = new Map(entries.map((entry) => [entry.version.id, entry.review.slug]));

  const claims = await reader.claim.findMany({
    where: { reviewVersionId: { in: versionIds } },
    include: {
      evidenceRelations: {
        select: { citationId: true, relationType: true, supportDirection: true },
        orderBy: { id: "asc" },
      },
    },
    orderBy: { id: "asc" },
  });
  const citations = await reader.citation.findMany({
    where: { reviewVersionId: { in: versionIds } },
    orderBy: { id: "asc" },
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
  const versionDois = await reader.reviewVersion.findMany({
    where: { id: { in: versionIds }, isExample: false, versionDoi: { not: null } },
    select: { versionDoi: true, review: { select: { slug: true } } },
    orderBy: { id: "asc" },
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

function toContradictionRow(
  entry: ContradictionEntry,
  statementByClaim: Map<string, SynthesisStatement>,
  claimTextById: Map<string, { text: string }>,
): ContradictionMapRow {
  const a = statementByClaim.get(entry.claimIdA)!;
  const b = statementByClaim.get(entry.claimIdB)!;
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
}

function zeroCounts(): Record<ContradictionEntry["kind"], number> {
  return { "genuine-contradiction": 0, "scope-difference": 0, "undetermined-scope": 0 };
}

/** Cross-review contradiction map with independence-aware classification. */
export async function getContradictionMap(): Promise<ContradictionMap> {
  const { statements, citations, archivedDois, claimTextById } = await assemble();
  const result = synthesize(statements, citations, archivedDois);
  const statementByClaim = new Map(statements.map((statement) => [statement.claimId, statement]));
  const counts = zeroCounts();
  const rows: ContradictionMapRow[] = result.contradictions.map((entry) => {
    counts[entry.kind] += 1;
    return toContradictionRow(entry, statementByClaim, claimTextById);
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
  const statementByClaim = new Map(statements.map((entry) => [entry.claimId, entry]));
  const contradictions: ContradictionMapRow[] = result.contradictions
    .filter((entry) => entry.claimIdA === claimId || entry.claimIdB === claimId)
    .map((entry) => toContradictionRow(entry, statementByClaim, claimTextById));
  return { summary, contradictions };
}

export interface ReplicationTriageRow extends RankedReplicationGap {
  text: string;
  reviewSlug: string;
  reviewVersionId: string;
  localClaimId: string;
  passportPath: string;
}

export interface ReplicationTriageSnapshot {
  corpusHash: string;
  capturedAt: string;
  rows: ReplicationTriageRow[];
}

const TRIAGE_CACHE_ENTRIES = 3;
const triageByCorpusHash = new Map<string, Promise<ReplicationTriageSnapshot>>();

function replicationCorpusHash(input: AssembledInput): string {
  return sha256(
    canonicalJson({
      statements: input.statements,
      citations: input.citations,
      archivedDois: input.archivedDois,
    }),
  );
}

/**
 * Deterministic evidence-gap ordering for human editorial triage. The output
 * deliberately has no quality/truth score and never creates or publishes a brief.
 */
function computeReplicationTriageRows({
  statements,
  citations,
  archivedDois,
}: AssembledInput): ReplicationTriageRow[] {
  const result = synthesize(statements, citations, archivedDois);
  const synthesisByClaim = new Map(
    result.statements.map((entry) => [entry.claimId, entry.summary]),
  );
  const contradictionCounts = new Map<
    string,
    { genuine: number; scopeDifference: number; undeterminedScope: number }
  >();
  const countsFor = (claimId: string) => {
    const current = contradictionCounts.get(claimId) ?? {
      genuine: 0,
      scopeDifference: 0,
      undeterminedScope: 0,
    };
    contradictionCounts.set(claimId, current);
    return current;
  };
  for (const contradiction of result.contradictions) {
    for (const claimId of [contradiction.claimIdA, contradiction.claimIdB]) {
      const counts = countsFor(claimId);
      if (contradiction.kind === "genuine-contradiction") counts.genuine += 1;
      else if (contradiction.kind === "scope-difference") counts.scopeDifference += 1;
      else counts.undeterminedScope += 1;
    }
  }

  const ranked = rankReplicationGaps(
    statements.map((statement) => ({
      claimId: statement.claimId,
      scopeDeclared: Boolean(statement.scope),
      independence: synthesisByClaim.get(statement.claimId)!,
      contradictions: countsFor(statement.claimId),
    })),
  );
  const statementByClaim = new Map(statements.map((statement) => [statement.claimId, statement]));
  return ranked.map((entry) => {
    const statement = statementByClaim.get(entry.claimId)!;
    return {
      ...entry,
      text: statement.text,
      reviewSlug: statement.reviewSlug,
      reviewVersionId: statement.reviewVersionId,
      localClaimId: statement.localClaimId,
      passportPath: passportPath(statement),
    };
  });
}

async function replicationTriageSnapshot(): Promise<ReplicationTriageSnapshot> {
  const input = await assemble();
  const corpusHash = replicationCorpusHash(input);
  const existing = triageByCorpusHash.get(corpusHash);
  if (existing) return existing;

  const pending = Promise.resolve().then(() => ({
    corpusHash,
    capturedAt: new Date().toISOString(),
    rows: computeReplicationTriageRows(input),
  }));
  triageByCorpusHash.set(corpusHash, pending);
  while (triageByCorpusHash.size > TRIAGE_CACHE_ENTRIES) {
    const oldest = triageByCorpusHash.keys().next().value as string | undefined;
    if (!oldest || oldest === corpusHash) break;
    triageByCorpusHash.delete(oldest);
  }
  void pending.catch(() => {
    if (triageByCorpusHash.get(corpusHash) === pending) triageByCorpusHash.delete(corpusHash);
  });
  return pending;
}

export async function getReplicationTriage(limit = 100): Promise<ReplicationTriageRow[]> {
  const boundedLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  return (await replicationTriageSnapshot()).rows.slice(0, boundedLimit);
}

/** Exact triage snapshots for a bounded set of claims selected by an editor. */
export async function getReplicationTriageForClaimIds(
  claimIds: string[],
): Promise<ReplicationTriageSnapshot> {
  if (claimIds.length < 1 || claimIds.length > 20 || new Set(claimIds).size !== claimIds.length) {
    throw new Error("One to twenty unique claim ids are required for a triage snapshot.");
  }
  const selected = new Set(claimIds);
  const snapshot = await replicationTriageSnapshot();
  return { ...snapshot, rows: snapshot.rows.filter((entry) => selected.has(entry.claimId)) };
}

/** Recompute only the canonical corpus identity inside a publication transaction. */
export async function getReplicationCorpusHash(reader: Prisma.TransactionClient): Promise<string> {
  return replicationCorpusHash(await assemble(reader));
}

function isExampleCitation(rawJson: string | null): boolean {
  if (!rawJson) return false;
  try {
    return (JSON.parse(rawJson) as { isExample?: boolean })?.isExample === true;
  } catch {
    return false;
  }
}
