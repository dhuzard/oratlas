# Private research credit: initial contract / projector (R0 prototype)

Status: **implementation foundation only; NOT a production authorization gate**.
Tracks [ORAtlas #202](https://github.com/dhuzard/oratlas/issues/202),
[#205](https://github.com/dhuzard/oratlas/issues/205) and
[#207](https://github.com/dhuzard/oratlas/issues/207).

This narrow, framework-independent slice introduces:

- The closed, versioned `oratlas.private-cross-finding/0.1.0` schema in
  `packages/contracts/src/private-research-credit.ts`.
- The fourteen canonical CRediT role IDs and display labels.
- Exact per-project source artifact identities, immutable revisions/hashes, roles
  and provenance with explicit distinctions between original publication authors,
  source curators/reviewers, the person producing a new cross-finding, and an
  AI/software activity. A citation or shared DOI is not evidence derivation.
- A pure, read-only, *owner-only* projection in
  `packages/knowledge/src/private-research-credit.ts`. It obtains
  `read` **and** `cross-project-process` decisions independently for both
  projects. Every denial, absent principal, malformed record and authorization
  service error returns the same `null` response. Each request must recheck
  grants; there is no hidden cross-request cache.
- Adversarial tests for A-only, B-only, intersection user, lost membership,
  missing processing consent, invalid provenance, accidental source-as-bridge
  authorship, and distinct human versus software attribution.

## Critical trust boundary

**Do not expose these contracts in an anonymous route or public graph.**

ORAtlas currently uses an archive-public visibility model; this PR does not
change existing archived review, PublicationVersion, canonical graph, search,
feed, preserved-file API, alert, AI prompt, export or public contributor
semantics. It deliberately adds **no** database model, request handler,
background job, worker, index, private document storage or publication endpoint.

The projector is defense in depth. A future authenticated endpoint MUST:

1. Resolve the current principal from a trusted server-side session. NEVER
   accept principal ID, ORCID, group role or membership as a caller-supplied
   authority.
2. Authorize project membership and artifact read **at the data/connector query
   boundary before loading** protected bytes. The protected draft must be
   resolvable only in an owner-scoped storage namespace.
3. Supply an authoritative, up-to-date `authorize` function, evaluating
   project membership **and** project-controller cross-project processing policy
   separately for both sources. A source-provided boolean or ORCID roster is not
   authorization.
4. Revalidate access on every request and before returning any derived,
   cached, asynchronously produced, exported or linked content. Invalidate
   queued jobs, caches, short-lived URLs and encrypted derived artifacts when
   source permissions change. Handle mid-request revocations using transactional
   reads/versioned permission epochs or equivalent; the pure projector cannot
   guarantee atomic authorization across two different source providers.
5. Authorize **cross-project AI processing separately**: access permission alone
   does not approve sending data to an external model, nor a provider's data
   retention policy.
6. Return an indistinguishable not-found response for unavailable/unauthorized
   private records. Protect observability, search hit counts, error details,
   indices, collaborator/ORCID pages and inference from response timing.
   The projector does not solve side-channel issues by itself.
7. Keep any *publication* or cross-group acknowledgement separate from the
   personal proposal. Each private source controller must approve the precise
   released content, target audience, scientific provenance and contributor
   attribution, with individual consent where appropriate.

**Infrastructure administrators do not automatically become scientific-project
members.** A break-glass process, if ever approved, must have a separate legal
basis, narrow time-limited grant and immutable independent audit.

## Provenance, CRediT and scientific meaning

The 14 CRediT roles are represented with fixed machine-readable IDs. They
describe **human contributions to an exact output**, not publication authorship,
data ownership, reading permission, number of citations, AI work or scientific
validity. The human contribution records are **assertions**. Source-declared
roles, names and ORCID strings are not automatically verified or consented.
Only a human-confirmed declaration may be labelled `confirmed` in the draft
record. A future authenticated workflow must verify and log the person whose
approval it represents; the current model does not certify such an assertion.

Examples of different targets:

| Output origin | Representation |
| --- | --- |
| Original paper author | Source-scoped `publication-author` attribution, no automatically assigned CRediT role on the new output |
| Curator of a Diggypaper finding | Source-scoped curator assertion; optional explicitly recorded Data curation |
| Scientific reviewer of a supporting quote | Source-scoped `source-evidence-reviewer`, not independent verification of an unrelated new discovery |
| Scientist linking A and B | Cross-finding-scoped Conceptualization when that contribution was actually documented |
| Agent proposing a similarity | `activities[].actorKind=software`, model/run provenance; never assigned an ORCID or a CRediT human role |

The current cross-finding status is private `candidate`, `human-reviewed`
or `rejected`; it cannot transition directly to a publicly verified
scientific relation, ORAtlas TRUST assessment, confirmed replication or
accepted scholarly publication. A new relation requires its own source-evidence
linkage, human scientific decision and publication authorization.

Source references include project/tool ID, artifact kind, exact artifact ID,
version and SHA-256. A shared DOI, author name, ORCID, article text or similarity
score cannot establish a scientific link or group membership. Unknown
bibliographic DOI is allowed and never invented.

## Required follow-ups / not implemented here

- [#202](https://github.com/dhuzard/oratlas/issues/202): ratify the complete
  multi-principal and non-interference threat model, including administrator,
  provider, cache, indexing, analytics and retention behaviour.
- [#203](https://github.com/dhuzard/oratlas/issues/203): verified ORCID account
  linking, contributor-assertion confirmation, dispute and consent.
- [#204](https://github.com/dhuzard/oratlas/issues/204): separate private
  workspace/member/artifact storage with least-privilege query-time ACL.
- [#206](https://github.com/dhuzard/oratlas/issues/206), Diggypaper
  [#55](https://github.com/dhuzard/diggypaper/issues/55), CRT
  [#17](https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge/issues/17):
  source-controlled producer identity, immutable credit/provenance companions
  and revocable export grants.
- [#205](https://github.com/dhuzard/oratlas/issues/205): personal candidate
  discovery and opt-in UI only **after** the above authorization gates.
- [#207](https://github.com/dhuzard/oratlas/issues/207): reviewed CRediT
  attribution, provenance, contributors' approvals and a controlled private
  to public release path with mandatory original evidence citations.

Do not integrate this prototype into the global canonical graph, public
`GET /api/graph`, the public archive index, ORAtlas public contributor API or
public CRT/Diggypaper exports until these dependencies are independently
implemented and security-tested.
