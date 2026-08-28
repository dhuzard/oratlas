/**
 * `@oratlas/publications` — the generic publication boundary.
 *
 * Framework-free domain logic for independently hosted scientific
 * publications. No Prisma, no React, no network: persistence and transport
 * stay swappable behind the interfaces their callers own.
 *
 * `Review` is one publication type. Existing review storage remains
 * authoritative and projects into this boundary; an external publication is a
 * native record in it. Both eventually reach the canonical knowledge graph
 * through an explicit, reviewed decision — never through inference here.
 */
export * from "./identity.js";
export * from "./structural-provenance.js";
export * from "./review-projection.js";
export * from "./adapters/myst.js";
export * from "./protocol/jsonl.js";
export * from "./protocol/resolve-url.js";
export * from "./protocol/xref.js";
export * from "./registration/capture.js";
export * from "./registration/errors.js";
export * from "./registration/fetcher.js";
export * from "./registration/limits.js";
export * from "./registration/register.js";
export * from "./registration/source-bytes.js";
