import type { EditedMetadata } from "@oratlas/contracts";
import type { Prisma } from "@oratlas/db";

export interface CreateSubmissionInput {
  inspectionToken: string;
  submitterId: string;
  editedMetadata?: EditedMetadata;
  /** Revision lineage: the changes-requested submission this one resubmits. */
  previousSubmissionId?: string;
}

export interface CreateSubmissionResult {
  submissionId: string;
  status: string;
}

export interface EditorialOverrideInput {
  checkId: string;
  rationale: string;
}

export interface AcceptanceResult {
  reviewSlug?: string;
  nodeVersionIds: string[];
  selectedNodeIds: string[];
  idempotent: boolean;
}

export class SubmissionError extends Error {
  constructor(
    message: string,
    public readonly code: "bad-request" | "forbidden" | "conflict" = "bad-request",
  ) {
    super(message);
    this.name = "SubmissionError";
  }
}

export type SubmissionForAcceptance = Prisma.SubmissionGetPayload<{
  include: { repository: true; snapshot: true; inspectionCapture: true };
}>;
