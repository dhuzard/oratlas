# Product strategy

Status: recommendation for review, 2026-10-28. V/I/H meanings: [diagnosis](01-product-diagnosis.md). All comparisons below are strategic judgments, not market research.

## Three viable positions, and one tempting overreach

| Position                                         | Clarity                                                             | Problem frequency / importance (H)                           | Differentiation (I)                                                         | Feasibility / architecture reuse (V/I)                                                    | Adoption friction (I)                                                            | Extensibility / sprawl risk (I)                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Public AI-review archive                         | Clear deposit/read promise, narrower audience                       | Episodic release; important preservation                     | Exact repository preservation and assessment history                        | Highest immediate readiness: archive, wizard, editorial, exports already implemented      | GitHub artifact preparation and editorial wait                                   | New formats possible; moderate editorial-feature sprawl                               |
| Scientific verification and certification ledger | Precise for publishers/operators; less obvious for ordinary readers | At release or audit; potentially high stakes                 | Version-bound packets, independent verifier lifecycle, attributable results | Substantial existing code; external scientific services and evidence remain prerequisites | Protocol registration, usable inputs and operator setup                          | Strong infrastructure direction; high risk of proliferating protocols and badges      |
| **Evidence comparison workbench**                | **“Compare these claims and inspect why they differ”**              | Repeated during reviews, interpretation and project handoffs | Exact occurrences + evidence + durable, contestable relationship decisions  | Existing graph/provenance/curation reusable; pair UI and generic projection missing       | Public preloaded example is low friction; adding own sources remains constrained | Private teams and agents can extend it later; bounded if outcome stays comparison     |
| Universal cross-tool private knowledge workspace | Attractive but vague about first outcome                            | Potentially frequent; willingness to switch unknown          | Generic aggregation/chat is insufficient differentiation                    | Lowest current readiness: private authority, connectors, arbitrary-source capture missing | Source access, consent, import work, migration and team onboarding               | Very high sprawl risk across notes, authoring, search, chat, projects and permissions |

**R:** choose the comparison workbench as primary. Use the public archive as acquisition and source infrastructure, verification/certification as attached evidence, and agents as a parallel access channel. Keep the private workspace direction conditional on demand and the existing security gates. Do not market a “shared workspace” as currently operational.

**Trade-off:** this reduces the headline importance of substantial verification work. A publisher/operator market may prove more valuable; if users mainly want to publish check results rather than compare assertions, the ledger positioning should win. Test that decision, not just alternative wording. The workbench also needs a deliberately limited first corpus; it will not consolidate a scientist's entire research history in its first release.

Evidence: [home](../../../apps/web/src/app/page.tsx), [verification](../../../apps/web/src/lib/scientific-verification.ts), [certification](../../../apps/web/src/lib/certification.ts), [comparison](../../../apps/web/src/lib/review-comparison.ts), [publication boundary](../../external-publications.md), [private plan](../../private-workspace-execution-plan-2026-10-21.md).

## Product definition and pitch

**One sentence (H):** ORAtlas helps researchers compare scientific claims across sources, inspect their evidence and preserve reusable, attributable conclusions without losing the original context.

**Thirty-second pitch (H):** Your papers and AI tools can produce different answers to the same scientific question. ORAtlas puts the relevant claims side by side, with their exact sources, scope and linked evidence. You can see whether they really disagree, record what still needs checking and reuse the comparison in your next review or tool. Original assertions remain intact, AI suggestions remain suggestions, and every recorded decision has an author and a history.

For the initial release, append: “Start with the public sources already in ORAtlas.” Durable team conclusions are a later capability; the initial reusable artifact is an exact comparison link and source references.

## Primary persona and job

**H: primary persona:** a scientist responsible for synthesizing evidence on a narrow research question, often coordinating a small review team. They already read papers and use an AI assistant/reference manager. Their costly moment is deciding whether two apparently inconsistent claims refer to the same conditions and whether cited evidence actually supports either one.

**Job:** “When sources give different accounts of an important finding, help me inspect the exact assertions and their evidence, so I can explain the difference and reuse that reasoning without reconstructing it next time.”

Top outcomes:

1. Explain an apparent disagreement, including what remains unresolved.
2. Trace each assertion and judgment to its exact source version and evidence.
3. Reuse the comparison through stable links/structured records and, later, collaborative decision history.

Return trigger **H:** another source, a corrected version or a colleague's review changes the interpretation. Version history, current-head assessment comparison and lifecycle feeds can support return; a personalized alert subscription or saved comparison workspace should not be described as already shipped.

## Why keep existing tools?

The competitive baseline was checked against official documentation on the audit date. This is a capability comparison, not exhaustive testing or proof that competitors cannot implement these workflows.

| Existing tool                      | Documented baseline                                                                                                                                                                                      | ORAtlas must add enough value to justify a second tool (H)                                                                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ChatGPT                            | Projects collect chats, files and instructions, support sharing and recurring work. [Official documentation](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)                           | A durable, tool-independent record of exact assertions, reviewed relationships and corrections; “shared AI workspace” alone is not distinctive.                                             |
| Claude                             | Projects supply chat context and a document knowledge base. [Official documentation](https://support.anthropic.com/en/articles/9517075-what-are-projects)                                                | A comparison result the next model/client can inspect with the same occurrence identities and attributed decisions.                                                                         |
| NotebookLM                         | Source-grounded chat exposes citations that open quoted context; the current help page is served as Gemini Notebook. [Official documentation](https://support.google.com/gemininotebook/answer/16179559) | Preserve differences among source assertion, relationship suggestion, human judgment and subsequent correction across publications and tools. Citations alone do not differentiate ORAtlas. |
| Zotero                             | Collections/tags organize references; groups support shared libraries. [Collections](https://www.zotero.org/support/collections_and_tags), [groups](https://www.zotero.org/support/groups)               | Claim-level, exact-version comparison and contestable relationships. Continue using Zotero for bibliography management.                                                                     |
| Obsidian                           | Backlinks and graph views connect notes and reveal local neighborhoods. [Graph](https://obsidian.md/help/plugins/graph), [backlinks](https://obsidian.md/help/plugins/backlinks)                         | Typed, attributed scientific relations with evidence and source-version context; drawing connections is not itself the advantage.                                                           |
| Conventional document/wiki systems | Assumption: users can already write a comparison table and share a document; actual workflows must be observed                                                                                           | Reduce the cost of maintaining provenance and revisions enough to beat that table. If not, the workbench is unnecessary.                                                                    |

Do not claim superiority at drafting, general question answering, reference capture or personal note organization. The differentiated architecture is credible; a differentiated user benefit remains a hypothesis.

## Graph role and scope

**V:** canonical graph identity, exact occurrences and typed edges support traceability; the visual landscape and canonical graph are distinct projections. **I:** the graph adds most value as infrastructure. **R:** use side-by-side text and scope/evidence rows for decisions, lists for discovery, a small contextual graph for multi-hop exploration. Graph manipulation is never a prerequisite for a comparison.

ORAtlas is primarily a **claim comparison and evidence workbench**, secondarily a publication registry and review record. “Knowledge integration” describes its technical capability. “Workspace” can eventually describe the container; it should not replace a concrete value proposition.

## Minimum valuable experience and metrics

**H:** choose a prepared public comparison → inspect two exact assertions → open their source/evidence → reuse an exact comparison link with a clear unresolved/recorded-status label. No project setup, login or import is needed to demonstrate value. Import becomes the next action once the researcher understands the output.

**North star:** weekly researchers who complete a qualifying evidence comparison and reuse its references. A qualifying comparison contains two distinct exact source occurrences, inspection of both provenance views and at least one evidence/source passage, followed by copy/export/share of the exact reference set. Count people/sessions, not number of generated edges; consent-based pseudonymous measurement only. This is a behavioral proxy, not scientific correctness. Initial user research uses observed tasks instead of speculative production telemetry.

Supporting metrics: first-session qualifying-comparison rate; time to first qualifying result; second qualifying session in days 7–28; successful import-to-visible-claims rate for supported inputs; correction burden and source-context comprehension. Operational definitions and denominator rules: [09](09-validation-plan.md).

## Non-goals

- Manuscript authoring, another chat assistant, a reference-manager replacement or general project management.
- Universal ingestion of every PDF, note, AI chat or private repository in the MVP.
- Automatic claim merging, truth scores, model-vote consensus or computed evidence independence.
- Owning TRUST.md, MyST syntax, upstream review protocols or external scientific algorithms.
- Public promotion of private working material; account identity is not workspace authority.
- Making replication marketplaces, synthesis publishing, certification browsing or graph visualization coequal starting experiences.
- A graph database, embedding service, vector store, new microservice or MCP server solely to modernize the product story.

**Decision gates:** validate the persona and return trigger before saved-workspace implementation; validate demand for own-source import before new format contracts; validate the workbench against the ledger proposition before redirecting the roadmap; retain all scientific and privacy governance regardless of the selected positioning.
