import { createHash } from "node:crypto";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import type { KnowledgeIndexData } from "../../packages/knowledge/src/types.js";
import { PUBLIC_SELECT_TABLES } from "./sql.js";
import { G1_FIXED_CLOCK } from "./capture.js";

/** The real index-builder's Prisma read closure, not a production permission policy. */
export const INDEX_READ_TABLES = [
  "Citation",
  "Claim",
  "ClaimEvidenceRelation",
  "KnowledgeNodeVersion",
  "Person",
  "RepositorySnapshot",
  "Review",
  "ReviewContributor",
  "ReviewVersion",
  "TrustAssessment",
  "TrustVerification",
] as const;

export const INDEX_CONTROLS = {
  hidden: "g1-review-control",
  tombstone: "g1-index-tombstone",
  withdrawn: "g1-index-withdrawn",
  invalidSha: "g1-index-invalid-sha",
} as const;

export const INDEX_PROTOCOL = "oratlas.g1.index-consumer/0.1" as const;
export function indexDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** Parent runner must inspect both stdout/stderr before preserving even redacted logs. */
export function indexRunnerOutputProblems(output: string, secrets: readonly string[]): string[] {
  return [
    ...(secrets.some((secret) => secret.length > 0 && output.includes(secret))
      ? ["credential in index child output"]
      : []),
    ...(["G1_INDEX_EXCLUDED_", "Control claim that must stay hidden."].some((marker) =>
      output.includes(marker),
    )
      ? ["excluded marker in index child output"]
      : []),
  ];
}

/** Expectations deliberately require populated successes; excluded sentinels alone are insufficient. */
export function indexContentProblems(index: KnowledgeIndexData): string[] {
  const problems: string[] = [];
  const reviews = index.reviews.map((row) => row.reviewId);
  for (const id of ["g1-review-1", "g1-review-2", INDEX_CONTROLS.withdrawn])
    if (!reviews.includes(id)) problems.push(`missing review ${id}`);
  if (index.reviews.length !== 3) problems.push("expected exactly three indexed reviews");
  for (const id of [INDEX_CONTROLS.hidden, INDEX_CONTROLS.tombstone, INDEX_CONTROLS.invalidSha])
    if (reviews.includes(id)) problems.push(`excluded review ${id}`);
  const withdrawn = index.reviews.find((row) => row.reviewId === INDEX_CONTROLS.withdrawn);
  if (withdrawn?.status !== "withdrawn") problems.push("withdrawn metadata status lost");
  if (index.claims.length !== 2) problems.push("expected two populated public claims");
  if (index.citations.length !== 1) problems.push("expected one populated public citation");
  if (!index.claims.some((row) => row.reviewId === "g1-review-1" && row.relations.length === 1))
    problems.push("missing populated claim/evidence relation");
  if (!index.claims.some((row) => row.reviewId === "g1-review-2"))
    problems.push("missing second public claim");
  const serialized = canonicalJson(index);
  for (const marker of ["Control claim that must stay hidden.", "G1_INDEX_EXCLUDED_"])
    if (serialized.includes(marker)) problems.push(`excluded marker ${marker}`);
  if (index.claims.some((row) => row.reviewId === INDEX_CONTROLS.withdrawn))
    problems.push("withdrawn claim escaped");
  if (index.identifierConflicts.length !== 0) problems.push("unexpected identifier conflicts");
  return problems;
}

export interface IndexCapture {
  protocol: typeof INDEX_PROTOCOL;
  clock: string;
  label: string;
  roleContract: "public-runtime" | "read-only-probe";
  stateTables: readonly string[];
  index: KnowledgeIndexData;
  indexSha256: string;
  stateBeforeSha256: string;
  stateAfterSha256: string;
}

export function indexCaptureProblems(capture: IndexCapture): string[] {
  const tables =
    capture.roleContract === "read-only-probe" ? INDEX_READ_TABLES : PUBLIC_SELECT_TABLES;
  return [
    ...indexContentProblems(capture.index),
    ...(capture.protocol === INDEX_PROTOCOL ? [] : ["protocol mismatch"]),
    ...(capture.clock === G1_FIXED_CLOCK ? [] : ["clock mismatch"]),
    ...(["baseline", "baseline-repeat", "after", "after-repeat"].includes(capture.label)
      ? []
      : ["invalid run label"]),
    ...(["public-runtime", "read-only-probe"].includes(capture.roleContract) &&
    Array.isArray(capture.stateTables) &&
    canonicalJson(capture.stateTables) === canonicalJson(tables)
      ? []
      : ["invalid authority or state scope"]),
    ...([capture.indexSha256, capture.stateBeforeSha256, capture.stateAfterSha256].every((value) =>
      /^[a-f0-9]{64}$/u.test(value),
    )
      ? []
      : ["invalid evidence digest"]),
    ...(capture.indexSha256 === indexDigest(capture.index) ? [] : ["index digest mismatch"]),
    ...(capture.stateBeforeSha256 === capture.stateAfterSha256
      ? []
      : ["consumer mutated database"]),
  ];
}

/** Labels describe runs; every index field and public state digest must match exactly. */
export function indexCaptureDifferences(first: IndexCapture, second: IndexCapture): string[] {
  return [
    ...indexCaptureProblems(first),
    ...indexCaptureProblems(second),
    ...(first.roleContract === second.roleContract &&
    canonicalJson(first.stateTables) === canonicalJson(second.stateTables)
      ? []
      : ["authority or state scope differs"]),
    ...(canonicalJson(first.index) === canonicalJson(second.index) ? [] : ["index bytes differ"]),
    ...(first.stateBeforeSha256 === second.stateBeforeSha256
      ? []
      : ["public fixture state differs"]),
  ];
}
