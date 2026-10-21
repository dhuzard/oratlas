/** Declarative only: production imports belong to the opt-in test runner. */
export const KNOWN_MUTATION_ROUTE_MODULES = {
  "api/comments/[id]": "@/app/api/comments/[id]/route",
  "api/notifications": "@/app/api/notifications/route",
  "api/reviews/[slug]/versions/[versionId]/comments":
    "@/app/api/reviews/[slug]/versions/[versionId]/comments/route",
} as const;
/** This deterministic subset adds no privileges beyond the existing Notification readAt update. */
export const KNOWN_MUTATION_COLUMN_GRANTS = {
  Notification: ["readAt"],
} as const;
