# Executive decision

For review, 2026-10-28. Audit baseline `c02db1bf55fce2bc5a98ea3c915a22e9885e30bc`. No redesign implemented. V = verified, I = inference, H = hypothesis; proposed actions are recommendations.

## 1. What should ORAtlas become?

**An evidence comparison workbench for researchers reconciling scientific claims.** Start with public, captured sources: select two assertions, inspect exact context and evidence, explain what differs, and reuse the references. This focus is **H**, supported by **V** existing occurrence/provenance/relationship machinery. It must beat a researcher's current AI assistant plus comparison table in observed tasks.

The broad shared knowledge workspace hypothesis is materially misaligned with today's operational scope. Private authority, general notes/chat ingestion and durable team comparisons are not unlocked by a new homepage. Preserve that possible direction, but do not make it the MVP promise. [Strategy](03-product-strategy.md), [architecture](07-architecture-impact.md).

## 2. What should it stop trying to be?

Stop presenting archive, graph explorer, verification ledger, certification catalog, chat, replication marketplace and future private knowledge hub as coequal reasons to start. Stop competing with source authoring, personal notes and general AI chat. Keep useful existing infrastructure and records; defer expansion. No evidence supports deleting supposedly unused features. [Inventory](02-feature-inventory.md).

## 3. Three biggest current problems

1. **V/I: conflicting identity and entry paths.** README/normative rules are review-first; runtime is verification-led; roadmap is private-workspace-led. Users are asked to select a subsystem before a scientific task.
2. **V/I: no complete claim-pair outcome.** Explore duplicates intent collection and emphasizes traversal; Compare compares review coverage; import and private collaboration do not fulfill the broad workspace promise.
3. **V: scientific language can overclaim.** Computed “independent families” conflicts with decision §8; deterministic “Genuine contradiction” sounds adjudicated; a home CTA can call an entire publication verified. These need correction before more polished presentation. [Diagnosis](01-product-diagnosis.md).

## 4. What genuinely differentiates it?

**V:** immutable exact source occurrences, canonical identity distinct from occurrence, relation-specific assessments with history, attributable proposals/decisions, lifecycle-aware public APIs and version-bound verifier/certifier evidence. **I:** their combination can preserve a comparison across tools and revisions. **H:** researchers will value this enough to return. A graph or cited chatbot answer alone is not differentiation.

## 5. Which pages leave primary navigation?

Verification, Certifications, Discuss and Developers move to contextual/utility access. Editorial remains role-scoped utility access. Keep exact verification/certification records public and link them from their source. Graph, Nodes, Coverage, Replications and generated syntheses stay secondary; most are already specialist links, so do not pretend they currently occupy the header.

| Current primary                                                               | Proposed primary                    | Secondary / utilities                                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------- |
| Explore · Publications · Verification · Certifications · Discuss · Developers | **Find claims · Compare · Sources** | Account · Editorial by role · Help / API & agents; contextual Checks, Connections and Ask |

Source: [layout](../../../apps/web/src/app/layout.tsx). This proposes a reviewed update to [UI_UX_RULES](../../../UI_UX_RULES.md), not an unannounced override. [Migration map](05-information-architecture.md).

## 6. What do home and the workbench look like?

Home gives one promise and one primary action: **Compare two claims**. It opens an honest public example with enough evidence to inspect. The main workbench has one question/query, readable candidates, exact pair selection and a side-by-side comparison. Source context opens next to the assertion; graph, raw hashes, protocols and provider controls are secondary. Do not call this a private workspace. [Wireframes](06-ux-wireframes.md).

## 7. Smallest valuable experience

**Open prepared public pair → inspect scope and both sources → inspect linked evidence → copy exact comparison references.** No login, import, workspace creation, model key or automatic relationship confirmation. A missing/ambiguous relationship is a valid result. Saving team judgments comes later. [Journeys](04-user-journeys.md).

## 8. What can happen without backend rewrites?

Navigation, consistent labels, one Explore form, contextual checks/Q&A, better empty states, shared detail composition and preserved deep links. A claim-pair view needs a small bounded read composition over existing exact-record services. Unified discovery across legacy/external sources, saved decisions, private authority, arbitrary imports and delegated writes are real backend work. No new graph database or microservice is justified. [Architecture](07-architecture-impact.md).

## 9. What must users validate?

Comparison versus verification-led demand; the primary persona's recurring pain; usefulness of exact reusable references; list/side-by-side versus graph defaults; supported-source friction; need for saved decisions/private teams. Proposed study: seven participants, counterbalanced tasks, separate scientific-comprehension and usability measures. No outcomes exist yet. [Validation](09-validation-plan.md).

## 10. First five tasks and top ten actions

First five tasks are roadmap P0-1–P0-5, in order. Product review precedes implementation.

| Order | Priority | Action                                                                  | Backend consequence                                     |
| ----- | -------- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| 1     | P0       | Correct independence, contradiction and verified-publication wording    | UI first; explicit review of machine/derived semantics  |
| 2     | P0       | One Explore input; recoverable empty states; fix SVG accessibility      | None                                                    |
| 3     | P0       | Choose an exact, honest public comparison fixture and entry CTA         | Existing records/seed; no new schema                    |
| 4     | P0       | Build one exact claim-pair comparison with scope/evidence/provenance    | Bounded read composition                                |
| 5     | P0       | Copy/reopen exact references; run first-session study                   | None for link reuse                                     |
| 6     | P1       | Three task destinations; contextual Q&A/checks; revise product contract | None; reviewed public snapshot changes                  |
| 7     | P1       | Shared claim/source layouts and explicit corpus coverage                | Tabs first; generic search separately scoped            |
| 8     | P1       | Simplify supported-source import and recovery                           | Current import contracts retained                       |
| 9     | P1       | Contextual review actions and role-specific editorial queues            | Existing authority retained                             |
| 10    | P2/P3    | Gate saved/private work and integrations on demonstrated need           | Explicit contracts/security work; defer broad expansion |

Full problems, dependencies, risks, files, acceptance and validation: [roadmap](08-roadmap.md).

## Evidence and meaningful blockers

Local app ran on isolated seeded SQLite; public screens, deterministic Q&A, claim traversal and mock editor entry were exercised. One serious Explore axe defect was observed. Schema/OpenAPI and warmed-server agent-navigation checks passed. Targeted tests had a source-credit fixture failure; producer acceptance also failed on MyST byte hashes and verifier setup timeout. A read-only diagnostic showed CRLF checkout conversion explains the observed MyST claims digest difference; no bytes/pins were changed and acceptance is **not** claimed. [Evidence record](evidence/README.md).

Meaningful blockers to the broad vision: private authorization/storage, unsupported source capture, heterogeneous search/read projections, general delegated writes and byte-exact producer acceptance. These do not block designing the public comparison slice. Protect existing identities, source versions, evidence subjects and API compatibility throughout.
