# ORA-J01 security and immutable-publication audit — July 2026

This checklist records the standing ORA-J01 review against `main` after PR #71. A property is
marked **verified** only when a focused regression test or an exact code invariant is named.
Findings discovered during the sweep are listed separately so the audit does not turn absence of
evidence into a security claim.

## Request and authorization boundary

| Property                                                                                                                                | Result                | Evidence                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cookie-authenticated JSON mutations require exact configured `Origin`, `application/json`, and same-origin Fetch Metadata when supplied | Verified and hardened | `apps/web/src/lib/mutation-request.ts`; `mutation-request.test.ts`; `editorial-api.ts`; `comments-mutation-routes.test.ts`                                                                            |
| Editorial decisions re-read the current database role rather than trusting a role snapshot in the cookie                                | Verified              | `apps/web/src/lib/auth.ts`; forbidden-user integration cases across editorial lifecycle, monitoring, federation, execution passports, replication, protocol drift, synthesis, and node-edge decisions |
| Public-write and expensive public-read surfaces are body-bounded, schema-validated, and rate-limited                                    | Verified              | `apps/web/src/lib/api.ts`; comment, submission, inspection, discussion, DOI, federation, replication, monitoring, and editorial route tests                                                           |
| Comment removal is one attributable state transition under retry and concurrency                                                        | Remediated            | Transactional visible-status CAS plus audit insert in `apps/web/src/lib/comments.ts`; `comments-race.test.ts`                                                                                         |

The federation inbox is intentionally not protected by browser same-origin checks: it is a
server-to-server signed inbox with its own content-type, signature, replay, and payload controls.
Anonymous discussion and DOI validation do not authorize a user state transition, but retain body
and rate limits.

## Immutability, publication, and audit trail

| Property                                                                                                                                             | Result     | Evidence                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review correction, withdrawal, and tombstone transitions use revision CAS and write lifecycle plus audit records atomically                          | Verified   | `apps/web/src/lib/review-lifecycle.ts`; concurrency cases in `article-lifecycle.integration.test.ts`                                                           |
| Submission acceptance and editorial decisions fail closed on retry, stale revision, or conflicting idempotency payload                               | Verified   | Domain integration suites for submissions, node publication, synthesis editorial, monitoring, federation, replication, execution passports, and protocol drift |
| Tombstoned review prose, metadata, claims, files, comments, feeds, and DOI projections are unavailable                                               | Verified   | `apps/web/src/lib/reviews.ts`; `article-lifecycle.integration.test.ts`                                                                                         |
| Repository-derived node and graph projections require either a readable published review for the snapshot or their own accepted node-only submission | Remediated | Public node/graph query guards plus review-tombstone and node-only regression coverage added by ORA-J01                                                        |
| Accepted scholarly versions remain append-only; corrections create successors and tombstones expose only the lifecycle notice                        | Verified   | Prisma constraints and database guards; `docs/article-lifecycle.md`; lifecycle integration suite                                                               |

## Untrusted content and network boundary

| Property                                                                                                                                                                  | Result     | Evidence                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| Repository URLs canonicalize to `github.com/{owner}/{repo}` and reject credentials, lookalikes, IP literals, local/private targets, nonstandard ports, and unsafe schemes | Verified   | `packages/github/src/url.ts`; `url.test.ts`                                                    |
| GitHub API requests use the exact trusted API origin, refuse redirects, time out, and stop reading before a per-response byte cap                                         | Remediated | `packages/github/src/transport.ts`; `transport.test.ts`                                        |
| Zenodo metadata requests use the exact trusted API origin, refuse redirects, time out, and stop reading before a per-response byte cap                                    | Remediated | `packages/zenodo/src/client.ts`; `client.test.ts`                                              |
| Inspection never clones, builds, executes, or follows repository-provided download URLs; file, total, tree, and count budgets remain enforced                             | Verified   | `packages/github/src/inspect.ts`; `inspect.test.ts`                                            |
| Repository-derived prose remains escaped text and JSON-LD cannot terminate its script container                                                                           | Verified   | `article-reader.test.ts`; `json-for-html.test.ts`; hostile graph and synthesis rendering cases |
| Server credentials stay in server-only construction paths and cannot be redirected to configurable alternate service origins                                              | Remediated | Exact-origin constructor validation in GitHub and Zenodo transports; transport/client tests    |

## Residual, bounded risks

- Network byte limits are per response. Inspection additionally enforces file, aggregate decoded
  artifact, tree-entry, and file-count budgets; a future defense-in-depth improvement may add one
  aggregate transport-byte budget across the whole inspection.
- DNS or certificate compromise of the fixed GitHub or Zenodo service origins is outside the
  application trust boundary.
- Read-receipt transitions are user-local notification state, not publication or editorial state,
  and are therefore not included in the append-only scholarly audit requirement.

## Verification bar

The ORA-J01 branch must pass the repository verification bar (`lint`, `typecheck`, unit/integration
tests, JSON schema checks, web build, and affected e2e suites). Focused security tests are run first
so a full-suite infrastructure failure cannot hide a regression in a remediated property.
