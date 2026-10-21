/** Declarative inventory; production handlers are imported only by the opt-in capture spec. */
export const EDITORIAL_READ_ROUTE_MODULES = {
  "api/editorial/process": "@/app/api/editorial/process/route",
  "api/editorial/federation": "@/app/api/editorial/federation/route",
  "api/reviews/[slug]/update-proposals": "@/app/api/reviews/[slug]/update-proposals/route",
  "api/federation/inbox": "@/app/api/federation/inbox/route",
} as const;

/** Additional SELECT closure, never write privileges or live provider access. */
export const EDITORIAL_READ_SELECT_TABLES = [
  "Submission",
  "ReviewRound",
  "FormalReviewReport",
  "AuthorResponse",
  "DecisionLetter",
  "FederationNotification",
  "CitationStatusRecord",
] as const;
