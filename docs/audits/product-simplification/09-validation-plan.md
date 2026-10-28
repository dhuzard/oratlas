# Measurable validation

This is a proposed evaluation, not a report of user outcomes. Existing repository [first-reader protocol](../../first-time-exploration-evaluation.md) has no participant results inspected here. Local browser checks prove rendered behavior only. V/I/H: [01](01-product-diagnosis.md).

## Operational definitions

Define a **qualifying comparison** as two distinct exact source occurrences, inspection of both provenance views and at least one relevant evidence/source passage, followed by reuse of the exact reference set. An unsupported assertion may still be useful if the output explicitly records the evidence gap; do not reward invented support. In research sessions, verify the participant's explanation; in telemetry, the event sequence is only a proxy.

| Metric                      | Start / numerator                                                                                                                 | End / denominator and exclusions                                                                                                                     | Interpretation                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Time to first useful result | First product-ready render or task start, recorded separately                                                                     | First qualifying comparison; report median and range plus censored/abandoned sessions, never drop failures from reporting                            | Speed of reaching inspectable value, not speed of generating text                              |
| First-session activation    | First sessions with qualifying comparison                                                                                         | All consenting eligible new-reader sessions; define session as ending after 30 minutes inactivity; exclude bots/staff/test traffic by declared flags | Behavioral activation; study comprehension reported separately                                 |
| Task completion             | Participants completing a prespecified task unaided                                                                               | All participants assigned that task; report assisted, incomplete, system-blocked separately                                                          | Avoid counting a technically successful click as a scientific task success                     |
| Navigation failure          | Task attempts where a participant cannot choose next destination within 60 seconds, takes a dead end, or requests navigation help | All assigned navigation task attempts; record distinct episodes and affected people                                                                  | Research observation. Production backtracking is only a possible proxy, not proof of confusion |
| Import success              | Supported-input attempts yielding a valid immutable capture and visible declared claims or an explicit no-claims outcome          | All attempts declared supported at preflight; report unsupported inputs separately; deduplicate retries by attempt                                   | Capture success, visible-claims success and editorial publication success are separate rates   |
| Claim matching precision    | Suggested equivalent pairs judged equivalent by scoped reference review                                                           | All judged equivalence suggestions; ambiguous reference cases reported separately                                                                    | Candidate precision, not factual correctness                                                   |
| Claim matching recall       | Relevant reference pairs surfaced within the bounded candidate set                                                                | All relevant pairs in the declared evaluation corpus; report truncation and abstentions                                                              | Do not extrapolate to the whole scientific literature                                          |
| Relationship classification | Correctly labeled equivalent/related/opposing/scope-different/undetermined pairs                                                  | Fully reviewed test pairs; confusion matrix plus per-class denominators                                                                              | Separate lexical similarity from semantic equivalence and missing scope from conflict          |
| Human correction burden     | Reviewer minutes plus rejected/edited proposed fields or pairs                                                                    | Per completed comparison and per reviewed candidate; retain rejection/abandonment counts                                                             | A “high acceptance rate” is meaningless if reviewers rubber-stamp                              |
| Evidence inspection         | Comparisons with an opened evidence/source passage                                                                                | All initiated comparisons; distinguish available from unavailable evidence; record both provenance sides separately                                  | Opened is not understood; comprehension task is separate                                       |
| Provenance access           | Exact source views successfully resolved                                                                                          | All provenance-open attempts; count unavailable/withdrawn/mislinked separately                                                                       | Exact-version/locator fidelity, not scientific confirmation                                    |
| Repeat use                  | Activated users completing another qualifying comparison on a different day in days 7–28                                          | Activated consenting cohort with full 28-day observation; report incomplete follow-up separately                                                     | Test real need; no reminder-induced activity mixed into organic retention                      |
| Collaboration               | Shared comparison with two distinct authorized human contributors who inspect it and one attributable review response             | Comparisons shared for review with an eligible recipient during period; record invites without response separately                                   | Do not count bot messages, page views or duplicate accounts as collaboration                   |

**North star:** weekly researchers who complete and reuse at least one qualifying comparison, deduplicated under a consented pseudonymous identity. Early pilot reports counts and denominators, not growth claims. A small sample cannot establish a reliable retention rate or statistical superiority.

## Usability versus scientific correctness

The product must make exact context discoverable and preserve judgments. It cannot establish scientific truth by improving completion rates. Track four independent outcomes:

1. **Usability:** task completion, time, help, navigation and recovery.
2. **Representation integrity:** exact tuple/locator/digest correctness, lifecycle, no mutation/merge, distinct assessments and provenance.
3. **Candidate quality:** relevance, scoped equivalence/relationship classification, explicit abstention and correction cost.
4. **Scientific interpretation:** domain reviewers' attributed judgments, disagreements and uncertainty. These are not a platform-wide truth benchmark.

Use a small adjudicated comparison set with two domain reviewers and preserved disagreement records. Suggested initial set: 30 pairs spanning equivalent paraphrases; same wording/different population; same DOI/different result; opposing directions with matched scope; contradictory-looking claims with missing context; shared datasets/derivatives; AI repetition; unrelated pairs. Balance classes explicitly before measuring. Do not designate model agreement as the reference label. Include known negative cases and unresolvable cases; “cannot determine” is a valid answer.

In particular, test that the new UI never infers evidence independence from missing overlap metadata and never promotes a machine suggestion to a confirmed relation. Exact provenance checks can be automated; semantic judgments cannot be reduced to hash matching.

## Lightweight study: seven participants

Recruit four scientists who synthesize literature, two research leads/review collaborators and one researcher/developer who regularly uses an external AI client. At least five should be new to ORAtlas. This is a recruitment target, not completed research. Use public/synthetic content; no sensitive project import or hosted private-workspace trial.

Run 45–60 minute moderated sessions. Counterbalance current and proposed comparison flows using matched public examples; alternate which comes first. Do not explain the graph vocabulary before the tasks. Prototype tests must be labeled prototypes; simulated import latency must not be compared as measured production performance.

| Task                                                                                 | Observe / record                                                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| View homepage for 20 seconds; explain product and next step                          | Whether participant identifies comparison + evidence + exact context, versus publishing, chat or truth scoring   |
| Find two relevant assertions and explain whether they disagree                       | First destination, extra forms, scope inspection, help and incorrect certainty                                   |
| Open each original context and identify supporting evidence                          | Correct occurrence/version; citation versus evidence; model assertion versus source assertion                    |
| Handle a same-source repetition and scope mismatch                                   | Whether participant incorrectly counts independent support or accepts semantic equivalence                       |
| Copy comparison references and reopen in a second browser                            | Exactness, usable output, comprehension of unsaved versus saved judgments                                        |
| Add a supported public source; recover from an expired capture or unsupported format | Import expectation, recovery, required metadata burden, understanding of editorial wait                          |
| Review a colleague's proposed relationship                                           | Suggestion versus confirmation; rationale and unresolved disagreement; distinguish formal challenge from comment |
| Keyboard/narrow-screen version of source drill-down                                  | Focus order, drawer return, paired scope reading and graph alternative                                           |

For the agent-oriented participant, substitute one task with discover → retrieve exact pair/packet → inspect lifecycle → return structured references. Test proposed write authorization as a design scenario; do not pretend a general delegated API exists.

Record pseudonymous IDs, task timings, completion/help codes and short structured error categories. Obtain consent for any recording; keep participant files outside the repository. Avoid free-text scientific content in analytics. The current evaluation CLI can inform reporting conventions, but its graph-first schema is not automatically the comparison-study instrument.

## Instrumentation proposal

Event families: `comparison_opened`, `source_context_opened`, `evidence_opened`, `references_copied`, `import_started`, `capture_completed`, `import_failed`, `relationship_reviewed`. These are proposed names, not existing instrumentation.

Minimum payload: event/version, pseudonymous session (and opted-in longitudinal identity if needed), public fixture/record-kind category, task mode, elapsed duration bucket, outcome/error category, boundedness and available-evidence flags. Do not log query text, claim text, free-form rationale, private IDs, source URLs, API keys or complete packets. For public-record linking, use a documented minimal reference strategy; private product telemetry needs a separate privacy review. Define retention and access before collecting, rather than borrowing scientific audit retention for behavioral analytics.

Instrument actual user intent: copy/export counts only after success, not button render. Page views do not mean source inspection. Permission denials, unavailable evidence and cancellations remain in denominators with their cause. Deduplicate retries and do not count automated smoke tests.

## Decisions requiring human evidence

| Decision                                         | Evidence needed before implementation/investment                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Workbench versus verification ledger positioning | Interview/task evidence of recurring comparison pain versus publisher demand for check results; willingness to reuse output |
| Graph secondary by default                       | Counterbalanced task results and preference reasons; preserve optional graph regardless                                     |
| Three primary destinations                       | First-click/task navigation observations and discoverability of developer/editor utilities                                  |
| Saved comparisons / “My work”                    | Repeat use of exact links and explicit demand for durable decision history                                                  |
| General chat/PDF/note import                     | Real input samples, source rights, frequency and achievable provenance; prototype review burden                             |
| Private team expansion                           | Named collaboration need plus existing authority/privacy/security gates; demand does not waive them                         |
| Automatic candidate ranking or embeddings        | Bounded retrieval baseline, reference-set precision/recall and acceptable correction cost                                   |
| Feature removal                                  | Actual use/support obligations and link/API dependency evidence; page complexity alone is insufficient                      |

The observed accessibility issue, unsupported independence language and identity/provenance invariants do not need an A/B test to justify correction. The exact implementation still needs review and validation.

## Provisional go / revise / stop rules

Agree thresholds before the study; these are suggested pilot criteria, not statistical guarantees. Proceed to a limited public pilot if at least 5 of 7 participants complete the comparison/provenance/reuse task unaided, no participant is left believing structural capture establishes correctness after using the output, and integrity/security regressions are zero. Revise when navigation or terminology causes repeated difficulty. Stop expanding the workspace proposition if participants prefer their existing comparison table and cannot name a recurring benefit from exact provenance/reuse.

Do not accept faster completion accompanied by worse scientific interpretation. Report every failed task and contradictory participant preference. A seven-person study informs design; a longer, consented pilot is needed for repeat-use and collaboration evidence. Release checks remain separate from product validation and from pinned producer interoperability.
