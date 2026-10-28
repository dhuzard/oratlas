# UX strategy and low-fidelity wireframes

These are proposed interactions (R/H), not implemented screens. They preserve exact identities and scientific distinctions. Evidence and current components: [01](01-product-diagnosis.md), [02](02-feature-inventory.md). Example counts/text below are illustrative fixture content, not measured product outcomes.

## Task, view and default

| Task                           | Default pattern                                     | Why / alternatives                                                             |
| ------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Find relevant claims           | Short list with source, scope and selection control | Easier to scan than a graph; optional filters and bounded result notice        |
| Compare two assertions         | Side-by-side text plus aligned scope/evidence rows  | Makes missing/different context visible; stack paired rows on mobile           |
| Compare many source properties | Table                                               | Suitable for coverage metadata; keep distinct from scientific claim comparison |
| Inspect a claim/source         | Detail page or accessible source drawer             | Exact passage and evidence links stay near the assertion; raw hashes folded    |
| Decide a relationship          | Side-by-side review with rationale and status       | Human action is explicit; similarity score is not a decision                   |
| Explore several hops           | Small contextual graph plus equivalent list         | Graph helps explain paths; never required for reading or comparing             |
| Ask for explanation            | Contextual conversation after selecting evidence    | Bounded packet visible; answer is a derived interpretation, not a new source   |
| Process editorial work         | Task queue with filters                             | Different actor/work from reader exploration; avoid a single giant dashboard   |

**R:** graph as secondary exploration and technical backbone. Keep the useful equivalent list, source links and explicit scope. Do not merely hide the current graph and leave its keyboard defect unresolved.

## 1. First visit

```text
ORAtlas                 Find claims   Compare   Sources        Account   Help

Compare scientific claims with their evidence
See what differs, inspect the original context, and reuse exact references.

[ Compare two claims ]                         primary: worked public example
Find claims for my question                     secondary link

Example: two accounts of replay and memory
  Source A: assertion with stated population and method
  Source B: assertion with different scope
  What you will inspect: statements → context → evidence
  Public demonstration • synthetic assertions clearly labeled

How it works: choose claims → inspect differences → reuse references
Already have a supported public source? Add a source
```

**Interaction:** primary CTA opens a prepared exact pair directly. No account, ontology choice, workspace name or provider key. Search is a secondary path, not a competing second primary button. If the example is unavailable, explain that state and offer the existing public claim list; never silently swap in an unrelated pair.

**V/I basis:** current [home](../../../apps/web/src/app/page.tsx) demonstrates a synthetic publication with absent check results in the default seed. Reuse the prominent primary action and visible demo labeling, change the outcome. **H:** a completed comparison explains the product better than the ledger pipeline.

## 2. Main workbench

```text
Find claims / Compare                               Public sources only
Question: [ How does replay relate to memory?                 ] [Find claims]

[Claims]   Sources   Connections                    Filters ▸
Results from: archived reviews [other source coverage explained]
Showing a bounded result set; more available →

[ ] Claim A: full readable assertion
    In Source A · exact version · population/method if declared
    1 linked work · source-asserted relationship · Open source
[ ] Claim B: full readable assertion
    In Source B · exact version · scope not fully stated
    1 linked work · Open source

Selected: A, B                                      [Compare selected claims]
```

**Interaction:** a single query field and result list; selected exact tuples survive opening a detail panel and using Back. “Connections” uses the same explicit selection; graph orientation does not replace canonical state. The question is task context, not a new persistent Question entity. No saved-workspace implication in the public MVP.

**Empty states:** no query → worked example and simple prompt; no results → keep query, clear filters, show source coverage and supported-input link; one result → inspect it or broaden the query, no invented second claim; more than two selections → explicitly choose a pair for the initial slice.

**V/I basis:** [Explore](../../../apps/web/src/app/explore/page.tsx), [KnowledgeLandscape](../../../apps/web/src/components/KnowledgeLandscape.tsx), [Claims](../../../apps/web/src/app/claims/page.tsx). Current mobile Explore is long because intent, links, graph, record cards and chat all stack. **R:** switch task views without losing selection; do not remove provenance to shorten the page.

## 3. Source import

```text
Sources → Add source                              Public import only
Use a source already in ORAtlas                    fastest path

Source type: (•) Public GitHub review/objects   ( ) Published MyST source
                                                   editor-assisted initially
[ URL                                                                    ]
Version: ( ) default branch now  ( ) exact tag  ( ) published release
[ Inspect source ]

Stage 1: Select source → Stage 2: Review capture → Stage 3: Submit

Captured: source title · selected revision · observed time
Claims available: declared valid / invalid / absent counts
Required corrections: [specific fields only]
Optional metadata ▸   Source declaration / full validation report ▸

[ Submit for editorial decision ]
Result: captured and submitted; not yet public or scientifically confirmed
```

**Interaction:** retain six internal wizard steps if needed, but group them into three user goals. Explicit version selection and per-field extracted/edited provenance remain. MyST is not passed to the GitHub inspector: route to the existing editor registration workflow with accurate permissions. Unsupported formats explain the boundary before accepting content. No enabled “private” switch until private authority exists.

**Errors/delays:** announce inspecting/capturing/validating stages, preserve entered metadata, name invalid fields, allow safe retry. Expired 30-minute capture requires reinspection with comparison of newly observed identity; never reuse an invalid capability. Absent declared claims is a valid result requiring source preparation, not automatic AI invention.

**V/I basis:** [SubmitWizard](../../../apps/web/src/app/submit/SubmitWizard.tsx), [inspection captures](../../../apps/web/src/lib/inspection-captures.ts), [register handler](../../../apps/web/src/app/api/editorial/publications/register/route.ts). This is supported-source simplification; arbitrary PDF/chat capture is separately deferred.

## 4. Claim comparison and relationship review

```text
Compare                            Public comparison • exact versions selected
Question / purpose (optional): _____________________________________________

Claim A                                      Claim B
Full assertion                               Full assertion
Source A · version · Open passage            Source B · version · Open passage

Population     rodents                       humans
Method         declared method               different / not stated
Outcome        memory measure                memory measure
Time/conditions  not stated                   not stated
                     “These scopes differ; inspect before calling a conflict.”

Evidence A                                   Evidence B
Source relation + asserted by                 Source relation + asserted by
Open cited passage                           Open cited passage
Shared source facts: both cite [work]; independence has not been established

Relationship: candidate / no reviewed relationship / editor-confirmed
Why suggested ▸     Separate assessment profiles ▸     Exact identifiers ▸

[ Copy exact references ]                    default reader primary action
Ask about this comparison                    secondary, explicit evidence scope

Authorized review mode:
  ( ) Equivalent in this scope  ( ) Related  ( ) Opposing  ( ) Cannot determine
  Scope observations: narrower/broader/different/unknown (not a new edge enum)
  Rationale: [                                                        ]
  [ Submit review ]     Reject suggestion     Leave unresolved
```

**Boundary:** the reader MVP has no general saved relationship mutation. Authorized review mode is a later composition of existing supported editor decisions; relationship types and authority must match contracts. Do not render all choices as writable if no corresponding operation exists. “Leave unresolved” can be session-only until persistence is deliberately added. A confirmed relationship is an attributed interpretation, not scientific verification.

**Interaction:** source drawer opens the exact passage and restores focus when closed. Side-by-side desktop; on narrow screens use scope rows containing A then B, with persistent labels. For a changed/withdrawn source, show lifecycle status and fail closed on withheld content. Conflicting assessment profiles remain expandable individually, with no mean score. A low-confidence candidate is not promoted by default.

**V/I basis:** current [Compare](../../../apps/web/src/app/compare/page.tsx) offers useful review selection but lacks paired claims; [same-claim panel](../../../apps/web/src/app/editorial/NodeIdentityProposalPanel.tsx) and [edge panel](../../../apps/web/src/app/editorial/NodeEdgeProposalPanel.tsx) already distinguish review decisions. [Synthesis](../../../apps/web/src/app/synthesis/page.tsx) needs candidate wording rather than “Genuine contradiction.”

## 5. Claim detail and provenance

```text
Back to comparison                            Claim in Source A · exact version

Full assertion
Source-declared statement / AI-derived assertion / reviewer interpretation
Population · method · outcome · conditions (unknown values explicit)

[ Inspect source context ]                     primary
Source A, version, section/paragraph/anchor
Original excerpt [escaped, with surrounding context]

Linked evidence
  Relation: supports [source assertion] → Cited work / exact artifact
  Assessed by X under protocol Y → criterion profile
  Another assessment disagrees → open both profiles

Related claims        Compare with…
Checks and certification ▸  [named protocol, outcome, limits]
History ▸                  [correction / supersession / withdrawal]
Technical provenance ▸     [capture, digest, canonical tuple, manifest]

Copy exact reference       Comment / formal challenge [distinct actions]
```

**Empty states:** no evidence → “No supporting evidence is linked here”; no assessment → “Not assessed here”; no exact passage → show preserved locator and unavailable-context reason. None implies falsehood, low quality or permission to infer context. An assessment protocol without criteria cannot be summarized as favorable. The original occurrence remains immutable if a researcher proposes a revised assertion.

**V/I basis:** [claim passport](../../../apps/web/src/app/claims/[versionId]/[localClaimId]/page.tsx), [canonical occurrence](../../../apps/web/src/app/graph/occurrences/[nodeId]/versions/[versionId]/page.tsx), [SourceEvidenceLinksCard](../../../apps/web/src/components/SourceEvidenceLinksCard.tsx), [TrustDisplay](../../../apps/web/src/components/TrustDisplay.tsx). Reuse their evidence/provenance functions; compose kind-specific data rather than collapsing identity types.

## Accessibility and consistency acceptance

- Repair the observed SVG `role="img"` with focusable descendants violation; verify the chosen interactive or noninteractive semantics, keyboard focus and equivalent list. [Axe evidence](evidence/axe-explore.json).
- Keep skip link, visible focus, programmatic labels and meaningful headings. Dynamic import/error/selection messages need appropriate announcements; do not announce entire graph rerenders.
- Every comparison action is keyboard-operable. Source drawers restore focus and have an accessible name/close action. Stacked mobile rows preserve A/B associations without color alone.
- Use one status vocabulary: source assertion, suggested relationship, editor-confirmed relationship, structural check, named scientific check, certification under protocol. No single green “trusted” badge across these categories.
- Show the primary task action consistently. Settings, raw identifiers, provider/model/key fields and protocol catalogs are progressive disclosures, not onboarding requirements.
- Test at 390px and 200% zoom, then with keyboard and a screen reader. Current no-overflow measurements and three axe scans are partial evidence, not an accessibility certification.
