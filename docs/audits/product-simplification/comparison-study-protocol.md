# Exact comparison usability study protocol

**Status: prepared, not run.** This protocol and its blank artifact do not contain participant data or study results. They assess whether readers can compare exact public claims, inspect source context and reuse exact references. They do not test scientific correctness, candidate-ranking quality, long-term retention or private-workspace access.

## Study question and scope

Can a new reader use ORAtlas to explain what is known and unknown about two public claim occurrences, inspect both source contexts and relevant evidence, and reopen the same exact pair without mistaking capture, shared citations or comparison for scientific confirmation?

Use only the seeded synthetic comparison and other public records approved for the session. Do not enter personal notes, unpublished material, credentials or sensitive project information. Do not ask participants to sign in or make editorial decisions. If a source is unavailable, preserve that as a system-blocked result; do not substitute another record during the task.

## Participants and session setup

Recruit 5–8 people: target four literature synthesizers, two research leads/review collaborators and one researcher/developer who regularly uses an external AI client. At least five should be new to ORAtlas. A five-person pilot should retain at least three literature synthesizers, one research lead and one external-AI user if available; label any recruitment deviations in the report using categories, without identifying details.

Run one moderated 45–60 minute session per participant. Use a public, prepared environment with no account requirement. Confirm that the participant consents to structured, pseudonymous observations before recording anything. Do not record audio/video by default. If separate recording consent is sought, store that recording outside this artifact under the separate consent and retention plan; do not put its filename, URL or transcript in the artifact. A participant may stop or withdraw; delete their session record on withdrawal.

Assign IDs `P01` through `P08` in order. Do not collect names, email, employer, institution, age, disability, project identity, exact discipline or other identifying demographics. Record role only as one of the schema categories, plus whether the participant is new to ORAtlas. Keep the artifact in a local file outside the repository and share only the aggregate after checking it for identifying details. Set a deletion date with the consent notice; the schema itself cannot enforce file deletion.

## Procedure

Do not explain navigation or graph terminology before the participant attempts each task. Read each prompt verbatim. Do not coach; if asked for help, record one help request and give only the minimum instruction needed to continue. Use a second matched example when counterbalancing flows; do not change source records mid-session.

| Task ID                        | Prompt                                                                                                                                    | Observe                                                                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `explain-promise`              | “Look at this page for 20 seconds. What do you think ORAtlas lets you do?”                                                                | Whether the participant identifies claims, linked evidence, exact context and the fact that a record can be inspected without endorsing its science.                            |
| `find-and-compare`             | “Use this question to find two claims that may be relevant. Tell me what you think their relationship is.”                                | First destination, time/help, whether the participant compares exact occurrences and uses uncertainty when context is missing.                                                  |
| `inspect-sources-and-evidence` | “Open the original context for each claim. Show me the source version and one relevant piece of evidence, if available.”                  | Exact source version, evidence availability and whether the source view resolves. A citation is not automatically evidence for the claim.                                       |
| `scope-and-source-reuse`       | “These claims mention overlapping sources and different conditions. Explain what the page supports you in concluding.”                    | Whether shared source use is mistaken for independent corroboration, and whether missing scope is treated as unknown rather than contradiction.                                 |
| `copy-and-reopen`              | “Copy the comparison references and reopen them in a separate tab. Are these the same two exact claims?”                                  | Successful copy or manual fallback, preserved pair, exact occurrence identity and understanding that no saved judgment was created. Never inspect or record clipboard contents. |
| `source-handoff`               | “You have a supported public repository to deposit. Find the next step. What would you do if the source type is unsupported?”             | Whether the handoff accurately distinguishes a guide, registration and import; no arbitrary PDF/private import promise. Do not submit real sources.                             |
| `review-proposed-relationship` | “A colleague proposes that these claims are related. Where would you inspect or respond, and what would make the relationship confirmed?” | Suggestion vs. confirmed relation, discussion vs. formal challenge, and no implication that a reader can exercise editor authority. Do not create or decide a proposal.         |
| `keyboard-source-drilldown`    | “Using the keyboard, open a source context and return to the same comparison.”                                                            | Offer this task to everyone. Record a decline as `incomplete` because it was offered; record help separately.                                                                   |
| `agent-read-only-recipe`       | For an AI-client user: “Find the read-only public route for retrieving exact records and show which identifiers keep the pair exact.”     | Discovery path, exact versions, lifecycle/provenance and limits. Do not imply a general delegated write or relationship-confirmation API exists.                                |

The AI-client task may replace `source-handoff` or `review-proposed-relationship` if the participant is better matched to that task; mark only assigned tasks in the artifact. Do not compare simulated import latency with production performance. If comparing a current and proposed UI, counterbalance order and use matched public examples; clearly label any prototype.

## Recording rules

Use the blank [artifact template](comparison-study-template.json). Record only consented participant code, broad role/new-to-product flags, task outcome, elapsed seconds, help count, allowlisted event code/side/result and three binary interpretation checks. Elapsed time is task time, rounded to the nearest five seconds; no wall-clock timestamps are needed.

The event list is a structured local observer aid, not browser or product telemetry. Record an event after observing it; never copy an address bar, query string, source passage, claim text, locator, record ID or clipboard. Do not add notes or custom fields. If the participant's explanation does not fit a binary interpretation check, mark the closest observed answer only when defensible; otherwise stop and revise the instrument before further sessions rather than inventing a score.

Outcomes:

- `completed`: finished the task without help.
- `assisted`: finished after moderator help.
- `incomplete`: did not finish for a participant or navigation reason.
- `system-blocked`: the application/source prevented the task from being completed.

Record every task offered to the participant, including a declined task as `incomplete`; that offered task remains in its denominator. Omit a task only when it was not offered under the protocol. Do not silently remove incomplete, unavailable-source or system-blocked attempts from their denominators. A withdrawal is deleted rather than counted. Stop if the participant withdraws consent or unintended sensitive content appears; do not preserve the sensitive content in notes.

## Local validation and reporting

Copy the blank template to a local path outside the repository, fill it only after each consented session, and set `studyStatus` to `in-progress`. Set it to `complete` only after 5–8 non-withdrawn session records are present. Validate and summarize with:

```sh
pnpm eval:comparison-study C:/private-study/comparison-results.json
```

The evaluator reads the named local file and prints aggregate counts only. It makes no network requests, writes no file, and does not emit participant codes. Invalid schema or extra fields fail closed. Do not commit participant artifacts or summaries containing small-cell combinations that could identify someone.

Report the actual sample size, recruitment-category counts, assigned-task denominators, unaided completions, assisted completions, incomplete/system-blocked counts, task-time medians and interpretation-check counts. Include all failures and protocol deviations. State clearly that a small usability study does not establish scientific correctness, statistical superiority, retention, or population-wide generalizability. No results exist until sessions are conducted and reviewed.

The provisional seven-person threshold in [validation plan](09-validation-plan.md) is a decision aid only. For a different sample size, agree how to interpret the actual counts before the sessions; do not rescale 5/7 mechanically. Keep usability, representation integrity and scientific interpretation as separate findings.
