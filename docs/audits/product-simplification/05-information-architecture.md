# Information architecture and migration

V/I/H: [01](01-product-diagnosis.md). Proposed structure is R; comprehensibility and frequency of use require validation. Consolidation below changes presentation, not canonical identity or API semantics.

## Current site map (V)

```text
Home: scientific evidence ledger / synthetic demonstration
Primary header
  Explore: topic + interests → graph → scoped Q&A
  Publications: external/generic exact versions → content/claims/checks/provenance
  Verification: protocols and runs → verification record
  Certifications: results → certification record
  Discuss: explanation → back to Explore
  Developers: Connect a publication → API documentation
  Editorial [editor only]; Sign in / account
Explore secondary
  Complete indexes: Claims; Archive
  Specialist tools: Nodes; Graph; Synthesis (Disagreement map);
                    Coverage; Replications; scoped Q&A
Archive / exact records
  Review → exact version / claims / citations / comments / challenges
         → version comparison / synthesis generations / exports / history
  Research object → exact version / graph / challenges
  Canonical occurrence → exact source / relations / packet
Contribution
  Create review guide → Submit → inspection → editorial decision
  External manifest registration [editor API, no equivalent import form]
Editorial
  submissions; lifecycle; challenges; TRUST; same-claim/edge proposals;
  synthesis; monitoring; protocol drift; federation; audit
  adjudications; replication editor; review rounds
Footer / machine discovery
  Legacy review archive; API & agents; Connect a publication
  OpenAPI, llms.txt, feeds and structured exact-record endpoints
```

Evidence: [layout](../../../apps/web/src/app/layout.tsx), [SpecialistTools](../../../apps/web/src/components/SpecialistTools.tsx), [Explore](../../../apps/web/src/app/explore/page.tsx), [editorial](../../../apps/web/src/app/editorial/page.tsx); complete route list in [02](02-feature-inventory.md).

## Organizing principle

| Alternative       | Strength                                                       | Problem in this repository                                                  | Decision                                                                        |
| ----------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Workspace-centric | Membership and persistent work are understandable containers   | No operational private workspace; setup would delay first value             | Later container if validated, not initial entry                                 |
| Project-centric   | Fits labs and cross-project collaboration                      | Risks duplicating upstream project management; authorization is substantial | Optional future scope filter and permission boundary                            |
| Claim-centric     | Directly matches existing graph/evidence entities              | Can become a technical registry without a motivating question               | Use claims as task objects, not the whole navigation model                      |
| Question-centric  | Starts with the scientific uncertainty and leads to comparison | No need to introduce a persistent Question model now                        | **Recommended task organizing principle:** find relevant claims, compare, reuse |
| Source-centric    | Familiar provenance and import model                           | Reading documents alone does not deliver cross-source integration           | Secondary Sources destination and entry from exact passages                     |

**R:** a question-led workflow with explicit claim selection and source context. Three top-level task destinations are sufficient for the public MVP. Do not invent a fourth dashboard to satisfy a numeric target. “My work” can be added only when useful saved work and appropriate authority exist.

## Proposed map and navigation hierarchy

```text
Home: “Compare scientific claims with their evidence”
  Primary CTA → worked public comparison
  Secondary → find claims for my question

PRIMARY
  Find claims [/explore]
    One topic/question input → readable candidates → select two
    Optional filters; exact source coverage; “Connections” graph view
  Compare [/compare]
    Exact claim pair → scope → evidence → recorded relation / unresolved
    Source drawer; contextual question; copy exact references
    Secondary: review coverage comparison; related disagreements
  Sources [/publications]
    Explicit tabs/filters: registered publications; archived reviews; research objects
    Add source action → supported source type → existing import/guide
    Exact source → content / claims & evidence / checks / history

UTILITIES
  Account; role-scoped Editorial; Help / Developers
  API & agents; adapter preparation; verification/certifier operator catalogs

CONTEXTUAL ADVANCED
  Raw capture/manifests; protocol details; export formats; full graph;
  synthesis coverage; replication briefs; federation / execution passports

LATER, ONLY AFTER VALIDATION AND GATES
  My work → saved comparisons and authorized project scopes
  Project membership/settings → separate private authority
```

### Destination responsibilities

| Destination       | Need / primary interaction                              | Existing pages consolidated                                            | Progressive disclosure / administration                                                                                           |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Find claims       | Find relevant assertions; select an exact pair          | Explore + legacy Claims entry + contextual graph discovery             | Filters, full record index, reasons for suggestion, graph; no provider setup in initial form                                      |
| Compare           | Explain relationship and inspect evidence; reuse result | Compare + disagreement map + contextual Q&A + claim-detail composition | Assessment profiles, related records, raw IDs, specialist relation view; editor decision only when authorized                     |
| Sources           | Inspect/add a known source and its versions             | Publications + Archive + Nodes entry                                   | Source-type tabs until generic search is implemented; content, checks, history, import reports; producer/operator setup elsewhere |
| Editorial utility | Complete governed tasks                                 | Existing dashboard, adjudications, rounds and replication editor       | Queues by task; authority unchanged; deep links retain their subjects                                                             |
| Developer utility | Connect producer/client/worker                          | Connect + API docs + agents guide; protocol catalogs                   | Machine contracts, capture, federation and worker operations remain separate from reader UX                                       |

The MVP Sources screen may be a composition of existing tabs/links. Calling it a unified search before adding a bounded cross-source projection would be misleading. Likewise, a public comparison screen must not be labeled a private workspace.

## Complete route migration mapping

Default policy: keep the old URL and render an improved contextual surface. A new label does not require a redirect. Parameter names below are illustrative **proposed UI parameters**, not changes to API contracts.

| Existing route(s)                                    | Proposed placement / route behavior                                    | Compatibility requirement                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `/`                                                  | New comparison-first entry                                             | Existing exact demo link remains reachable as an example                                                              |
| `/explore`                                           | Find claims; preserve existing graph-focus mode during transition      | Preserve `q`, interests, `focus`, `known`, review and relation filters; signed scopes must be regenerated server-side |
| `/claims`                                            | Find claims → legacy-review index tab; initially retain route          | Do not silently redirect to a different result corpus or discard filters                                              |
| `/compare`                                           | Claim-pair mode, e.g. explicit node/version tuples; retain review mode | `left/right` review slugs retain existing meaning; invalid/partial pairs produce a recoverable state                  |
| `/synthesis`                                         | Compare → Disagreements                                                | Keep query semantics and exact pair links; do not redirect to generated review content                                |
| `/publications`                                      | Sources, default registered-publication tab                            | Clearly distinguish stable publications from listed exact versions; pagination is separate work                       |
| `/archive`                                           | Sources → Archived reviews                                             | Preserve search/filter/pagination and synthesis/object result kinds                                                   |
| `/nodes`                                             | Sources → Research objects                                             | Preserve kind/filter/pagination behavior                                                                              |
| `/publications/[publicationId]/versions/[versionId]` | Exact Source detail                                                    | Keep exact pair and deep anchors; never redirect to latest                                                            |
| `/reviews/[slug]`                                    | Source detail, current readable review                                 | Retain lifecycle rules and established canonical URL                                                                  |
| `/reviews/[slug]/versions/[versionId]`               | Exact Source detail                                                    | Preserve article fragments, assets and exact version semantics                                                        |
| `/reviews/[slug]/compare`                            | Source → History → Compare versions                                    | Keep `from/to` version selection and diff meaning                                                                     |
| `/reviews/[slug]/changes`                            | Source → History → Synthesis changes                                   | Preserve generation pair; no conflation with source diff                                                              |
| `/reviews/[slug]/syntheses/[versionId]`              | Exact generated Source detail                                          | Preserve software/editor attribution, rights, citation anchors and immutable lineage                                  |
| `/claims/[versionId]/[localClaimId]`                 | Claim detail → exact source occurrence                                 | Keep legacy claim IDs and anchors; use shared presentation only                                                       |
| `/nodes/[id]`, `/nodes/[id]/versions/[versionId]`    | Object detail / exact object detail                                    | Current versus historical remains explicit                                                                            |
| `/graph/occurrences/[nodeId]/versions/[versionId]`   | Exact canonical record detail                                          | Keep human/agent bridge and exact tuple; dispatch by source kind                                                      |
| `/graph`                                             | Advanced Connections                                                   | Keep node seed/topic/filter semantics; do not conflate old graph API with canonical API                               |
| `/discuss`                                           | Compatibility entry explaining “Choose sources to ask about”           | Header entry removed; no scope fabricated from an old question URL                                                    |
| `/coverage`                                          | Advanced → Synthesis coverage                                          | Keep current exact-version coverage meaning; not an evidence-gap metric                                               |
| `/verification`, `/certifications`                   | Advanced catalogs; source Checks links                                 | Keep public catalog routes and protocol/outcome labels                                                                |
| `/verifications/[id]`, `/certifications/[id]`        | Exact check/result records                                             | No ID, lifecycle or interpretation change                                                                             |
| `/connect`, `/create-review`                         | Developer / source preparation guides                                  | Keep URLs; explain source type and handoff instead of promising import                                                |
| `/submit`                                            | Sources → Add source → Public GitHub deposit                           | Preserve source version, capture lease, validation and editorial submission semantics                                 |
| `/signin`                                            | Account utility / action-triggered auth                                | Preserve explicit safe return path; no requirement to read public records                                             |
| `/editorial`                                         | Role-scoped task queues                                                | Keep decisions, idempotency and audit; no role changes through layout                                                 |
| `/editorial/trust-adjudications`                     | Editorial → Assessment disagreements                                   | Designated-adjudicator permissions and recusal stay intact                                                            |
| `/editorial/replications`, `/editorial/rounds/[id]`  | Editorial specialist tasks                                             | Retain authorized participant access and exact round/brief scope                                                      |
| `/replications`, `/replications/[slug]`              | Advanced briefs and exact brief record                                 | Preserve published commitments and lifecycle history                                                                  |
| `/api-docs`, `/api-docs/agents`                      | Developer utility                                                      | Preserve machine discovery, OpenAPI and link relations                                                                |

## Labels that explain the task

| Internal/current term                        | Human label                         | Necessary qualification                                                     |
| -------------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| KnowledgeGraph / Traverse the evidence graph | Find claims / Connections           | Graph remains available as a view                                           |
| PublicationClaimOccurrence                   | Claim in this source                | Always show exact version/location                                          |
| Canonical claim / node                       | Linked assertion / research object  | “Same assertion” only after the relevant reviewed identity decision         |
| Assessment                                   | Evidence assessment                 | Assessor + exact protocol; not “truth score”                                |
| TrustVerification                            | Source record structurally reviewed | Never imply scientific confirmation                                         |
| VerificationRun                              | Check run                           | Name check, input version, outcome and limitations                          |
| CertificationRun/result                      | Certification under [protocol]      | Keep certifier, pilot/lifecycle status; not universal approval              |
| Manifest                                     | Source declaration file             | Raw schema/digest in advanced details                                       |
| ProvenanceAssertion                          | How this version was produced       | Source-declared versus execution-attested remains explicit                  |
| Same-claim proposal                          | Possible equivalent assertion       | Suggested versus reviewed, scope and rationale                              |
| Synthesis (disagreement route)               | Compare disagreements               | Separate from generated synthesis documents                                 |
| Coverage gaps                                | Synthesis coverage                  | It measures inclusion in accepted syntheses, not absent scientific evidence |
| Legacy review archive                        | Archived reviews                    | “Legacy” is an implementation history, not a reader need                    |
| Developers → Connect a publication           | Developer guide / Prepare a source  | A guide is not an import form                                               |

## Rollout / rollback

First ship component composition and labels behind a reversible presentation switch; retain old paths and parameter handling. Audit existing deep links, fragment anchors, metadata, API/service links and G1 public snapshots before any redirect. Redirect only where the target is semantically identical and automated checks prove parameter preservation. Update reviewed public baselines using the existing harness process, never hand-edit captured evidence. Keep APIs untouched. Rollback restores the prior composition/navigation and leaves all scientific records intact. See [roadmap](08-roadmap.md) for the acceptance slices.
