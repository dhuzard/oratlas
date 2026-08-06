import "server-only";

export { createSubmission } from "./submission-creation";
export {
  acceptSubmission,
  acceptSubmissionInTransaction,
  decideSubmission,
  decideSubmissionInTransaction,
} from "./submission-editorial";
export {
  type AcceptanceResult,
  type CreateSubmissionInput,
  type CreateSubmissionResult,
  type EditorialOverrideInput,
  SubmissionError,
} from "./submission-contract";
export type { SubmissionPayload } from "./submission-payload";
