import "server-only";
import {
  resolveEffectiveMetadata,
  type EditedMetadata,
  type ExtractedMetadata,
  type SubmissionValidationReport,
} from "@oratlas/contracts";
import { prisma, parseJsonColumn } from "./db";

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
  validation?: SubmissionValidationReport;
  metadataDiff: MetadataDiffRow[];
  editorialNote?: string;
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
    include: { submitter: true, repository: true, snapshot: true },
    take: 100,
  });

  return submissions.map((s) => {
    const extracted = parseJsonColumn<ExtractedMetadata | null>(s.extractedMetadataJson, null);
    const edited = parseJsonColumn<EditedMetadata | null>(s.editedMetadataJson, null);
    const validation = parseJsonColumn<SubmissionValidationReport | undefined>(
      s.validationReportJson,
      undefined,
    );
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
      validation,
      metadataDiff,
      editorialNote: s.editorialNote ?? undefined,
    };
  });
}

export interface AuditRow {
  action: string;
  subjectType: string;
  subjectId: string;
  actorLogin?: string;
  createdAt: string;
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
    details: parseJsonColumn<unknown>(e.detailsJson, {}),
  }));
}
