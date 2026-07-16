# Grounding evaluation harness

The grounding evaluation harness continuously exercises the production KG-12 synthesis prompt
builder, strict output parser, and grounding validator. It is an evaluation tool, not a generation
or publication path: it writes no database records or `AgentRun`, and it cannot publish anything.

## Offline evaluation

Run the deterministic suite from the repository root:

```sh
pnpm eval:grounding
```

Offline mode is the default. It does not read provider, model, or API-key environment variables and
makes no network request. CI runs this command with provider variables explicitly empty. A scripted
provider captures exactly one production request for every fixture; its response and the
deterministic fallback both pass through the same production parser and grounding validator.

Fixtures are auto-discovered in
`packages/knowledge/src/grounding-eval-fixtures`. Each `*.ts` file has one default export declared
with `defineGroundingEvalFixture`; there is no registry to edit. File names and fixture IDs use
lowercase letters, digits, and hyphens. Discovery and execution use code-unit sorting, and fixtures
run sequentially.

The checked-in corpus covers:

- an accepted baseline with exact DOI and node references;
- unknown references and wrong node/version ownership;
- an example-node reference, fabricated DOI, and reserved `10.5555/example` leakage;
- hostile prompt-injection text embedded in a node. The exact string must occur only in the
  canonical user packet and never in the byte-identical static system prompt.

## Optional real-provider evaluation

Real evaluation is deliberately opt-in and currently supports the bounded Anthropic adapter:

```sh
ORATLAS_GROUNDING_EVAL_REAL=1 \
LLM_PROVIDER=anthropic \
ANTHROPIC_API_KEY=... \
LLM_MODEL=claude-sonnet-5 \
pnpm eval:grounding
```

Only fixtures explicitly marked `realEligible` run. They execute sequentially with one request per
fixture, no retry, and a fixed 30-second per-request ceiling. The API key is transport configuration
only and never enters the report. Provider, key, and an explicit pinned model are all required;
missing or unsupported configuration is an operational error.

## Report v1

The command writes one canonical JSON object and no diagnostic prose. Case rows are sorted by ID:

```json
{
  "cases": [
    {
      "expectedOutcome": "accepted",
      "id": "baseline-positive",
      "observedOutcome": "accepted",
      "passed": true
    }
  ],
  "mode": "mock",
  "runnerVersion": "grounding-eval/1.0.0",
  "schemaVersion": "1.0.0",
  "summary": { "failed": 0, "passed": 1, "total": 1 }
}
```

Rejected expectations add only a stable `errorCode`. A runner-level failure has an empty case list
and a stable `operationalErrorCode`. Reports never contain timestamps or durations in mock mode and
never contain packets, prompts, packet/prompt hashes, raw provider or fixture output, exception
messages/stacks, environment values, secrets, or `AgentRun` data.

Exit status meanings are:

- `0`: every completed case matched its expectation;
- `1`: evaluation completed, but at least one observed result did not match its expectation;
- `2`: configuration, discovery, bounds, provider, timeout, or another operational invariant
  failed.

## Fixed bounds

The fixture directory is fixed and cannot be supplied on the command line. Discovery accepts at
most 100 directory entries and only regular `*.ts` fixture files. Fixture IDs are capped at 80
characters; each source file is capped at 1,500,000 bytes before import, and each fixture's
canonical packet, scripted response, and assertions are capped at 1,500,000 UTF-8 bytes in total. Request
assertions are capped at 20 strings and 2,000 characters per string. Production synthesis output
bounds still apply. All fixture metadata is validated before a provider is called.

These limits keep CI cost, memory, and provider exposure predictable. Add a new adversarial case as
one typed file within those bounds and run the offline command plus the unit tests before review.
