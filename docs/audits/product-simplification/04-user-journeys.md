# User journeys

Evidence labels: [01](01-product-diagnosis.md). Proposed journeys are H until tested; implementation gaps are stated explicitly. “Workbench” below means a comparison screen, not an existing private Workspace entity.

## Current paths reconstructed

| Starting intention     | Current path (V)                                                                                | Break in the intended outcome (I)                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Understand ORAtlas     | `/` → synthetic publication → check/provenance sections                                         | Fresh seed has no completed check or certification result; reader learns record types before receiving an answer                   |
| Find related knowledge | `/explore` → topic / interest → bounded graph → exact occurrence → Q&A                          | Two intent forms; graph traversal precedes asking; no claim-pair decision view                                                     |
| Compare findings       | `/compare` → choose two review slugs → counts and claim lists → individual records              | Comparison stays at review coverage level; scope differences and paired evidence need manual reconstruction                        |
| Add a source           | `/submit` → GitHub/version → Inspect → metadata → nodes → validation → submit → editor decision | Supported structured public repository only; not a notes/chat upload. Separate external-manifest registration is editor/API driven |
| Collaborate            | Sign in → comments or role-scoped editorial/challenge action                                    | Collaboration is public/editorial, not a private team workspace                                                                    |
| Agent reuse            | OpenAPI/guide → graph/packet/exact records → export/lifecycle                                   | Public reads viable; generic delegated knowledge submission not provided                                                           |

Sources: [Explore](../../../apps/web/src/app/explore/page.tsx), [Compare](../../../apps/web/src/app/compare/page.tsx), [wizard](../../../apps/web/src/app/submit/SubmitWizard.tsx), [registration](../../../apps/web/src/app/api/editorial/publications/register/route.ts), [agent guide](../../../apps/web/src/app/api-docs/agents/page.tsx), [local observations](evidence/browser-observations.json).

## Minimum valuable first session

**R:** do not begin with Create workspace → Import. That sequence adds configuration and source-contract friction before demonstrating value. Begin with a small, clearly labeled public example or two existing claims.

1. **Open a comparison.** Homepage primary CTA: “Compare two claims.” Open a preselected, exact public pair. A secondary search supports the user's own question.
2. **Inspect the difference.** Read two assertions with population/method/outcome/time/conditions. Unknown context is labeled “Not stated.” Show source-declared or editor-confirmed relation status; absence means “No reviewed relationship recorded.”
3. **Inspect evidence and provenance.** Open each source context and the relevant evidence. A scope difference may explain the apparent conflict; the interface does not decide that automatically.
4. **Reuse references.** Copy the exact comparison link plus source references. A private browser-only observation can remain unsaved; do not claim a durable judgment was recorded. Later review actions use existing editorial authority where applicable.

Target: four task stages, one selection screen and one comparison screen with a source drawer. Count actual interactions in testing; “four” is not a measured completion result. **H:** first meaningful result is being able to explain the difference with evidence, not seeing a generated summary.

Manual input: none for the example; otherwise a topic or two existing exact claims. Source import requires supported URL, deliberate source-version choice and confirmation of mandatory metadata/rights, not ontology setup. Automatic: fetch already-authorized public records, populate declared fields, calculate overlap facts and suggest candidates. Human control: interpreting scope, accepting/rejecting relationships, identity decisions, publication and release. Never silently infer equivalence from wording.

Reward: a compact explanation the scientist can inspect and cite. Next actions: change one claim, inspect a related disagreement, ask about the selected evidence, add a supported public source, or request an authorized review. Saved team decisions are a later milestone.

## Scenario A — individual scientist

**Goal (H):** reconcile claims in a paper, an AI conversation and research notes before drafting a review.

| Element            | Proposed experience and current limit                                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entry              | A shared exact comparison link or Find claims. Show a public example without login.                                                                                                                                                                                            |
| Required inputs    | First slice: two already captured public assertions. Later own-source slice: authorized text/document export, source title, exact source/version/locator where available, and attribution to the asserting person/tool. Missing DOI is allowed; missing context stays unknown. |
| Main actions       | Select assertions; read scope/evidence; distinguish differing conditions from opposing results; copy references. Later: nominate extracted spans and explicitly review candidate relations.                                                                                    |
| System actions     | Resolve immutable occurrences, show raw source assertions, expose shared-source facts and current assessment profiles; keep model-derived material labeled.                                                                                                                    |
| Outputs            | MVP: exact pair link + source references + existing recorded relation status. Later: saved versioned comparison note/review decision.                                                                                                                                          |
| Expected value (H) | Less manual reconstruction of “who said this, under which conditions, from what evidence?”                                                                                                                                                                                     |
| Failure states     | Unsupported notes/chat/PDF import; no declared claim; unavailable source; ambiguous target; expired capture; no evidence; apparent contradiction disappears with scope.                                                                                                        |
| Friction           | GitHub-specific deposit is excessive for a note; DOI-only matching is insufficient; the current claim explorer excludes external-publication occurrences.                                                                                                                      |
| Technical needs    | Existing canonical tuples/provenance and a bounded comparison read composition. Arbitrary text/chat capture and extraction review require a new contract/UI; private notes additionally require private gates.                                                                 |

**V:** current ingestion extracts declared artifacts and deterministic metadata; AI ingestion has a packet/validation slice, not a complete human-review flow. **R:** explicitly offer “Use an existing public source” now. Do not ask the scientist to make sensitive notes public to fit the importer. A ChatGPT/Claude assertion is attributed to that conversation/tool; unless its cited evidence is independently captured and inspected, it remains an unsupported assertion. Repetition by other models adds no independent support.

Evidence: [ingestion contract](../../../packages/contracts/src/ingestion-extraction.ts), [wizard](../../../apps/web/src/app/submit/SubmitWizard.tsx), [claim index](../../../apps/web/src/lib/index-builder.ts), [source occurrence contract](../../../packages/contracts/src/publications.ts).

## Scenario B — research team

**Goal (H):** two collaborators reconcile findings from related projects and record what needs further investigation.

| Element            | Proposed experience and current limit                                                                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry              | Initially shared public comparison link. Future: authorized project workbench with explicit membership.                                                                                                                           |
| Required inputs    | Two public records initially. For private work: active membership plus source-specific read/process rights; review purpose and authorized sharing audience. ORCID, names and project URLs are not grants.                         |
| Main actions       | Each reviewer inspects exact assertions/evidence; records a scoped interpretation; another person reviews it; disagreements remain visible. Private cross-project links remain personal until every origin authorizes disclosure. |
| System actions     | Keep original occurrences and assessor identities; distinguish suggestions, confirmed relations, comments and challenges. Future private system rechecks authority on reads, derivations and exports, including after revocation. |
| Outputs            | Current path: linked public discussion or existing editor decision with history. Future: versioned team comparison, unresolved questions and approved release record.                                                             |
| Expected value (H) | Reduce repeated debate and duplicated evidence gathering across collaborators without pretending disagreements are resolved.                                                                                                      |
| Failure states     | Reviewer lacks role; simultaneous stale decision; source withdrawn; conflicting protocols; collaborator's access revoked; one private origin forbids cross-project processing or release.                                         |
| Friction           | Global editorial authority differs from ordinary team peer review. Membership invitation, private notes and delegated team review are missing, not simply undiscoverable.                                                         |
| Technical needs    | Existing public comments/challenges and proposal revision checks; future separate private store, memberships, invitations, revocation, protected processing and decision authority.                                               |

**R:** pilot public collaboration with existing roles; do not relabel an editor queue “Team review.” For the private design, show “You can inspect this privately” separately from “You can share it with this team.” If access to either source disappears, deny derived comparison content; do not leak counterpart titles/counts through an old URL or notification.

Evidence: [comments](../../../apps/web/src/lib/comments.ts), [identity decisions](../../../apps/web/src/lib/node-identity-lifecycle.ts), [challenges](../../../apps/web/src/lib/challenges.ts), [security ADR](../../private-workspace-security-architecture.md), [existing issue 205](https://github.com/dhuzard/oratlas/issues/205).

## Scenario C — external AI agent

**Goal (H):** reuse an existing assertion/evidence pair from another tool and submit an attributable candidate without claiming authority to confirm it.

| Element            | Proposed experience and current limit                                                                                                                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry              | `/api-docs/agents`, service discovery/OpenAPI; no browser navigation required.                                                                                                                                                                |
| Required inputs    | Query or exact node/version tuple; caller's purpose. Public reads need no account. Proposal writes require a documented attributable identity/authority; a general delegated token mechanism is a future gap.                                 |
| Main actions       | Discover bounded candidates; retrieve exact occurrences and source packet; inspect lifecycle; return structured comparison to caller. For contribution, prepare a proposal for an authorized human or use an explicitly supported write flow. |
| System actions     | Validate exact schema, enforce pagination/limits, preserve provenance, reject unknown references, keep suggestions separate from confirmed edges; return machine-readable errors.                                                             |
| Outputs            | Exact references, source locations/digests where present, relation provenance/status, assessments by protocol, lifecycle, bounds and unresolved context. No “truth” field.                                                                    |
| Expected value (H) | A model-independent scientific memory that another client can inspect/replay, beyond a chat transcript.                                                                                                                                       |
| Failure states     | Unsupported schema, stale/withdrawn tuple, invalid signed cursor/scope, rate limit, no authorized write path, forged evidence ID, source prompt injection, revoked private scope.                                                             |
| Friction           | Existing writes rely on session/same-origin controls; verifier/certifier tokens are specialized. An external agent cannot assume its human's editor permissions.                                                                              |
| Technical needs    | REST/OpenAPI, graph/packet contracts and lifecycle already exist. Generic contribution needs scoped delegated authorization, idempotency and an explicit proposal payload before an MCP wrapper.                                              |

**R:** first demonstrate a read-only external-client recipe: discover → fetch exact pair → retrieve provenance → return comparison with limitations. Submission success should later mean “proposal recorded,” never “claim verified.” Duplicate requests must replay safely where supported. Respect `Retry-After` and returned cursors. A stale packet must be reacquired; do not fill missing content from a cached withdrawn record.

Evidence: [agent guide](../../../apps/web/src/app/api-docs/agents/page.tsx), [canonical API](../../canonical-graph-api.md), [publication packet](../../../apps/web/src/lib/publication-version-packet.ts), [graph curation](../../../apps/web/src/lib/graph-curation-ai.ts), [verification API](../../../apps/web/src/lib/verification-api.ts).

## Delays, failures and control

| State                                   | Interaction contract (R)                                                                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loading existing records                | Identify the two requested records, retain selection and show which part is pending. No fabricated percentage.                                                                                          |
| Inspecting a supported source           | Show capture/validation stages and exact selected revision; preserve editable inputs after a network failure. Current synchronous inspection remains synchronous until measured need justifies a queue. |
| Unsupported source/schema               | Explain accepted inputs and link preparation guidance; do not silently reinterpret the schema or execute source content.                                                                                |
| Capture expired                         | Explain the 30-minute capture lease; reinspection may observe changed bytes, so show the new identity before resubmission.                                                                              |
| Imported but not materialized/published | Distinguish captured source, valid declared claims, graph availability and editorial acceptance. “Processing complete” must not imply all four.                                                         |
| No matches                              | Keep the query; clear filters; show a labeled example or supported-source action. Do not invent semantic matches.                                                                                       |
| No usable evidence/context              | Keep the assertion visible with an explicit gap; “Cannot determine relationship” is a valid outcome.                                                                                                    |
| Concurrent review                       | Return conflict, reload current proposal revision and preserve the user's unsent rationale. Never overwrite the other reviewer.                                                                         |
| Provider unavailable                    | Keep inspected records available; offer the deterministic path. Model failure must not block source reading.                                                                                            |

The scientific distinctions are part of the task, not a disclaimer appended afterward: compare occurrences before identity; scope before contradiction; cited evidence before confidence; attributable judgment before confirmation; independent sources before counting support.
