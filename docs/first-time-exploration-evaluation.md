# First-time exploration evaluation

This protocol tests whether a reader who has not used ORAtlas can understand the product promise
and navigate its guided knowledge landscape. It is a research protocol, not evidence that the UI has
already been validated with people.

## Session protocol

Recruit 5–8 participants who have not used ORAtlas. Do not explain the interface before the tasks.
Use pseudonymous IDs such as `P01`; do not record names, contact details, free-form transcripts, or
behavioral telemetry in the evaluation file.

1. Show the homepage for 20 seconds. Ask: “What do you think this site lets you inspect?” Record
   whether the answer identifies a scientific claim, linked evidence, independent assessments or
   disagreements, and preservation of the original record.
2. Ask the participant to find material relevant to one of their interests and create a personalized
   landscape. Record whether they reach it without coaching.
3. Ask them to point out a review, claim, evidence record, assessment, and disagreement. Record each
   distinction independently.
4. Ask them to focus on one node, explain why it appeared, inspect its preserved record, and return to
   the overview. Record whether the return succeeds.
5. For participants who use or agree to try keyboard navigation, repeat the focus-and-return journey
   without a pointer. Record only completion, not disability or assistive-technology details.

## Recording and reporting

Create a local JSON file matching the strict schema in
`scripts/first-time-exploration-evaluation.ts`, then run:

```sh
pnpm eval:exploration ./path/to/pseudonymous-session-results.json
```

The report gives numerator, eligible-session count, and observed rate for each outcome. It deliberately
sets no automatic pass threshold: the team should inspect failures, revise the interface, and repeat
the protocol. Do not commit participant result files to the repository.
