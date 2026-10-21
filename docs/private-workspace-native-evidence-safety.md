# Native G1 evidence disclosure checks

The synthetic native capture callers initialize `createNativeEvidenceGuard` with the actual
production session signer and the explicit restricted database URL before observing native rows.
The factory seeds all six public principal recipes and the malformed/expired/tampered/missing-user
controls, guarding complete Cookie headers and each signed value, composite payload and HMAC.
Actual dispatched Cookie headers augment this set before handlers run. The public malformed recipe
value remains ordinary declared invalid input; its full header is guarded. Database URL and encoded
and decoded password components are explicit inputs. Known worker capability checks are reused.

The guard inspects full native snapshot results before assertions or hashes, each captured HTTP
record before response validation, and complete aggregate evidence before files. Native bodyBase64
bytes, JSON keys, string literals, nested JSON and Unicode escapes are inspected without rewriting
retained bytes. Fixed generic failures avoid formatting refused values; response/capture observation
errors also receive fixed errors. Pure public object identity and response bytes are preserved.
Primary, editorial-read and fresh-removal captures now validate before creating output files.

The common inspector limits individual strings to 16 MiB, cumulative inspected string bytes to
64 MiB, depth to 64 and visited entries to 250,000. The separate log inspector checks exact raw text
and at most 4,096 complete lines (including JSON string literals). Arbitrary embedded non-JSON or
ANSI fragments are not decoded. These are checks for explicit known capabilities and bounded JSON
representations, not a general obfuscation detector or a substitute for the unchanged authorization
and exact capture/state comparison contracts.

This test-only retrofit changes no production source, schema, grants, fixture, handler order or
SQL query. All existing serial table snapshots remain serial. No fields, IDs, clocks or state
comparisons are removed. Focused negative controls exercise actual HMAC fragments, escaped database
components, raw full-row mismatches, encoded confidence responses and unreadable response streams
before diagnostic callbacks, alongside byte-preservation checks. Parent native four-label reruns
must establish final-source positive evidence; these unit/source checks alone pass no G1 gate.

The default common inspector retains its 250,000-entry bound. The native factory explicitly selects
an aggregate budget of 1,000,000 total scheduled entries; queued plus already visited work is bounded
before enqueueing. All byte and depth limits remain unchanged. Measurement across 66 retained
baseline capture/state/auth artifacts found 283,924 entries for the actual 1,177-record capture,
619,323 for the largest complete artifact sidecar, and 656,504 for its actual capture/state pair.
The factory budget provides about 52% headroom over that measured largest runtime aggregate; it is
finite and does not exempt any record, envelope or state field. Future growth must be measured again.

Budget regressions retain the golden-derived 1,177-record shape and the exact corresponding native
capture (whose hash-only golden bodies cannot be reconstructed from the golden alone), plus the
largest native sidecar, as gzip data with raw-byte SHA-256 provenance. Their combined stress check
inspects over 900,000 entries. Tests also require the strict default to reject authentic oversized
aggregates and both budgets to refuse overflow. No accepted golden or native response is changed.
The counter-only measurement summary is `fixtures/native-evidence-budget.json`; original raw
artifacts remain attributed to the prior native runs. Final guarded native integration remains
parent work.
