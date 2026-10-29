# Comparison study moderator run sheet

**Status: draft for organizer review; no sessions have been run.** This sheet operationalizes [the study protocol](comparison-study-protocol.md). It does not establish consent, ethics, privacy, or retention approval. Do not recruit or record observations until the organizer settles the marked fields and approves the consent notice.

## Organizer decisions before recruitment

- **Study owner/contact for questions or withdrawal:** `[SETTLE]`
- **Consent notice approved by:** `[SETTLE]` on `[DATE]`
- **Artifact storage location and who can access it:** `[SETTLE; outside this repository]`
- **Retention period and deletion date rule:** `[SETTLE; do not infer one from this sheet]`
- **Who performs deletion, including withdrawn session records, and how deletion is confirmed:** `[SETTLE]`
- **Any separate recording plan:** `[NONE by default; if proposed, settle separate consent, storage and deletion terms before recording]`
- **Participant-facing environment and organizer responsible for it:** `[SETTLE; verify public/no-account access and logging before sessions]`

## Participant notice draft — organizer approval required

> You are invited to take part in a 45–60 minute moderated study of how readers use ORAtlas to inspect and compare public claim records. The study uses synthetic public examples and does not assess your scientific expertise or the scientific correctness of the examples. Taking part is voluntary. You may skip a task, stop, or withdraw at any time. With your permission, the moderator will record structured observations under a participant code: broad role, whether you are new to ORAtlas, task outcomes, rounded task times, help requests, and allowlisted interaction categories. We will not record audio or video by default, and we will not record your name, contact details, employer, institution, project details, claim text, source passages, URLs, source or record identifiers, or clipboard contents. Study records will be stored at `[APPROVED LOCATION / ACCESS]` and deleted according to `[APPROVED RETENTION PERIOD / DATE RULE]`. To withdraw or ask a question, contact `[APPROVED CONTACT]`. Please do not enter personal notes, unpublished material, credentials, or sensitive project information.

Before starting, explain the purpose and data handling in the approved notice and ask: **“Do you consent to the structured, pseudonymous observations described here?”** Proceed only after an unambiguous yes. Record consent in the artifact as `consentToStructuredObservation: true`; if consent is declined or withdrawn, do not record a session. No recording is part of this default procedure.

## Local environment preparation

Use a dedicated local study environment unless an organizer has separately approved and verified a public no-account environment. The repository's documented local setup is:

```powershell
pnpm install
pnpm --filter @oratlas/db db:generate
pnpm --filter @oratlas/db db:push
pnpm --filter @oratlas/db db:seed
pnpm dev
```

Open `http://localhost:3000` on the study computer. A local session requires the participant to control that computer while the moderator observes; it is not a remote-participant URL. `CLAUDE.md` documents these commands and the seeded local database; it does not establish a hosted study URL. For remote sessions, the organizer must provide and preflight a separately approved public environment. Do not expose a local server publicly without organizer approval and a separate environment review.

### Preflight checklist

- [ ] Confirm organizer decisions above and approved notice; confirm participant has consented before observation.
- [ ] Confirm the selected environment is public/no-account for the participant and check its logging/access conditions.
- [ ] Confirm the seeded homepage loads and shows **“Compare two claims · synthetic example.”**
- [ ] Follow it and check both exact claims resolve. The fixture is synthetic and comes from `packages/db/src/seed/data.ts`:
  - Side A: review `hippocampal-replay-computational-review`, source-local claim `claim-001`; declared scope: rodent hippocampus / electrophysiology; source-declared evidence direction: supports `ref-wilson1994`.
  - Side B: review `cortical-oscillations-attention-review`, source-local claim `claim-003`; declared scope: human cortex / intracranial EEG; source-declared evidence direction: contradicts `ref-wilson1994-shared`.
  - Both cite the reserved example DOI `10.5555/oratlas.example.wilson1994`. This is source reuse, not independent corroboration and not proof of scientific contradiction.
- [ ] Verify the resulting comparison URL has exact occurrence references and can be reopened in another tab. Do not write down or copy the URL into study records.
- [ ] Verify source-context and evidence links resolve. If unavailable, preserve the attempt as `system-blocked`; do not substitute another record.
- [ ] Preflight keyboard focus/return and a narrow 390px viewport. Decide before sessions whether the participant will use a narrow screen for the keyboard source task, and apply the same condition consistently or record the assignment as a protocol deviation.
- [ ] Have the blank template copied to an organizer-approved local path outside the repository. Do not use real participant information in a rehearsal artifact.

The homepage CTA resolves current seeded review versions to exact references. This sheet therefore names the stable fixture slugs and local claim IDs, not version IDs or a hard-coded comparison URL. Record no address-bar contents, source passages, claim text, locators, record IDs, or clipboard contents.

## Session flow and task assignment

Target 5–8 participants and 45–60 minutes each. Aim for four literature synthesizers, two research leads/review collaborators and one researcher/developer who uses an external AI client; for a five-person pilot, retain at least three literature synthesizers, one research lead and one external-AI user if available. Assign `P01`–`P08` in order; collect only one of the schema roles (`literature-synthesizer`, `research-lead`, `researcher-developer`) and the new-to-ORAtlas flag. At least five participants should be new to ORAtlas. Report recruitment deviations only as categories. Follow the full prompt and observation text in the [protocol](comparison-study-protocol.md); this sheet adds the missing fixed search question and assignment procedure.

For a single current-UI pilot, offer the protocol's first eight tasks to every participant, in protocol order, except that `agent-read-only-recipe` may replace `source-handoff` or `review-proposed-relationship` for a matched AI-client participant. Record the substitution before the session. Mark every offered task in the artifact, including declined tasks as `incomplete`; omit only a task that was never offered. If testing a proposed UI or counterbalancing flows, do not start until the organizer records the matched second example, exact links, flow order assignment, and which task each flow replaces; this sheet does not define or validate a second fixture.

For `find-and-compare`, give every participant this fixed question on a plain card: **“What do the archived examples say about replay during sleep across rodent and human contexts?”** Then read the protocol prompt verbatim: **“Use this question to find two claims that may be relevant. Tell me what you think their relationship is.”** The target pair is Side A `hippocampal-replay-computational-review` / `claim-001` and Side B `cortical-oscillations-attention-review` / `claim-003`. Do not point to the CTA or identify the pair in advance. Do not suggest that the records establish a scientific contradiction.

Use the protocol's prompts verbatim for the remaining tasks. Do not teach navigation or graph terms in advance, coach, or create editorial proposals. If asked for help, record one help request and give only the minimum instruction needed to continue. Stop if consent is withdrawn or sensitive content appears; do not preserve the content. Record the closest binary interpretation response only when defensible; otherwise stop and revise the instrument before more sessions.

## Observation and artifact handling

Use `comparison-study-template.json` as the blank input. Copy it outside the repository to the settled local storage location before sessions. After the first consented session set `studyStatus` to `in-progress`; add only schema-approved fields. Use rounded task seconds, allowlisted event codes/sides/results, help counts, and one task outcome (`completed`, `assisted`, `incomplete`, `system-blocked`). No free-text notes, timestamps, identifiers, source/claim content, or clipboard data. A withdrawn session is deleted and not counted.

Validate and print aggregate counts locally with:

```powershell
pnpm eval:comparison-study C:/private-study/comparison-results.json
```

Replace that example path with the organizer-approved local file path. The evaluator reads the named file and prints aggregate counts; it does not write the report. It rejects extra fields and invalid artifacts. Set `studyStatus` to `complete` only with 5–8 non-withdrawn session records. Keep participant artifacts and any identifying small-cell summaries out of the repository; share only checked aggregates. Apply the organizer-approved deletion schedule and document completion of deletion outside the participant artifact.

**No participant results are recorded in this run sheet.** Report actual counts, denominators, failures, deviations and interpretation-check totals only after sessions have been conducted and reviewed. A small usability study does not establish scientific correctness, statistical superiority, retention, or population-wide generalizability.
