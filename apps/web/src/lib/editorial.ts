import "server-only";
import {
  resolveEffectiveMetadata,
  type EditedMetadata,
  type ExtractedMetadata,
  type FacetCompatibilityReport,
  type SubmissionValidationReport,
} from "@oratlas/contracts";
import { prisma, parseJsonColumn } from "./db";
import { parseStoredSubmissionPayload, validNodeCandidates } from "./submission-payload";

export interface MetadataDiffRow {
  field: string;
  extracted: string;
  edited?: string;
  changed: boolean;
}

export interface EditorialSubmission {
  id: string;
  status: string;
  submittedAt?: string;
  submitterLogin: string;
  repository: { canonicalUrl: string; owner: string; name: string };
  commitSha?: string;
  treeSha?: string;
  sourceKind?: string;
  capturePayloadHash?: string;
  validation?: SubmissionValidationReport;
  compatibilityFacets?: FacetCompatibilityReport;
  metadataDiff: MetadataDiffRow[];
  editorialNote?: string;
  publicationTargets?: { proseReview: boolean; knowledgeNodes: boolean };
  nodeCandidates: Array<{
    id: string;
    kind: string;
    title: string;
    abstract?: string;
    text?: string;
    license: string;
    sourcePath: string;
    sourcePointer: string;
    fieldProvenance: Record<string, { file: string; pointer: string; commitSha?: string }>;
  }>;
}

const DIFF_FIELDS = [
  "title",
  "abstract",
  "license",
  "publishedReviewUrl",
  "releaseTag",
  "versionDoi",
  "conceptDoi",
  "zenodoRecordId",
];

export async function listSubmissions(statuses?: string[]): Promise<EditorialSubmission[]> {
  const submissions = await prisma.submission.findMany({
    where: statuses ? { status: { in: statuses } } : undefined,
    orderBy: { createdAt: "desc" },
    include: { submitter: true, repository: true, snapshot: true, inspectionCapture: true },
    take: 100,
  });

  return submissions.map((s) => {
    const extracted = parseJsonColumn<ExtractedMetadata | null>(s.extractedMetadataJson, null);
    const edited = parseJsonColumn<EditedMetadata | null>(s.editedMetadataJson, null);
    const validation = parseJsonColumn<SubmissionValidationReport | undefined>(
      s.validationReportJson,
      undefined,
    );
    const submittedPayload = parseStoredSubmissionPayload(s.submittedPayloadJson);
    const nodeCandidates = submittedPayload
      ? validNodeCandidates(submittedPayload).map((candidate) => ({
          id: candidate.node.id,
          kind: candidate.node.kind,
          title: candidate.node.title,
          abstract: candidate.node.abstract,
          text: candidate.node.text,
          license: candidate.node.license,
          sourcePath: candidate.sourcePath,
          sourcePointer: candidate.sourcePointer,
          fieldProvenance: candidate.fieldProvenance,
        }))
      : [];
    const effectiveExtracted = extracted
      ? resolveEffectiveMetadata(extracted, undefined)
      : ({} as Record<string, unknown>);
    const effectiveEdited = extracted
      ? resolveEffectiveMetadata(extracted, edited ?? undefined)
      : ({} as Record<string, unknown>);

    const metadataDiff: MetadataDiffRow[] = DIFF_FIELDS.map((field) => {
      const ex = String((effectiveExtracted as Record<string, unknown>)[field] ?? "");
      const ed = String((effectiveEdited as Record<string, unknown>)[field] ?? "");
      return {
        field,
        extracted: ex,
        edited: ed !== ex ? ed : undefined,
        changed: ed !== ex,
      };
    });

    return {
      id: s.id,
      status: s.status,
      submittedAt: s.submittedAt?.toISOString(),
      submitterLogin: s.submitter.githubLogin,
      repository: {
        canonicalUrl: s.repository.canonicalUrl,
        owner: s.repository.owner,
        name: s.repository.name,
      },
      commitSha: s.snapshot?.commitSha,
      treeSha: s.snapshot?.sourceTreeSha ?? undefined,
      sourceKind: s.sourceKind ?? s.snapshot?.sourceKind ?? undefined,
      capturePayloadHash: s.inspectionCapture?.payloadHash,
      validation,
      compatibilityFacets: submittedPayload?.compatibilityReport.facets,
      metadataDiff,
      editorialNote: s.editorialNote ?? undefined,
      publicationTargets: submittedPayload?.publicationTargets,
      nodeCandidates,
    };
  });
}

export interface AuditRow {
  action: string;
  subjectType: string;
  subjectId: string;
  actorLogin?: string;
  createdAt: string;
  platformVersion?: string;
  details: unknown;
}

export async function listAuditEvents(limit = 50): Promise<AuditRow[]> {
  const events = await prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: true },
  });
  return events.map((e) => ({
    action: e.action,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    actorLogin: e.actor?.githubLogin,
    createdAt: e.createdAt.toISOString(),
    platformVersion: e.platformVersion ?? undefined,
    details: parseJsonColumn<unknown>(e.detailsJson, {}),
  }));
}

export interface LifecycleEditorialReview {
  slug: string;
  lifecycleRevision: number;
  versions: Array<{
    id: string;
    label: string;
    publicState: string;
    commitSha: string;
    isCurrent: boolean;
  }>;
}

export async function listLifecycleEditorialReviews(): Promise<LifecycleEditorialReview[]> {
  const reviews = await prisma.review.findMany({
    where: { status: "published" },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      slug: true,
      lifecycleRevision: true,
      versions: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          semanticVersion: true,
          releaseTag: true,
          title: true,
          publicState: true,
          snapshot: { select: { commitSha: true } },
        },
      },
    },
  });
  return reviews.map((review) => ({
    slug: review.slug,
    lifecycleRevision: review.lifecycleRevision,
    versions: review.versions.flatMap((version, index) =>
      version.snapshot
        ? [
            {
              id: version.id,
              label: version.semanticVersion ?? version.releaseTag ?? version.title,
              publicState: version.publicState,
              commitSha: version.snapshot.commitSha,
              isCurrent: index === 0,
            },
          ]
        : [],
    ),
  }));
}
