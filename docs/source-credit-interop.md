# Source-native credit interoperability — offline adapters (ORAtlas #209)

**Status:** offline mapping/fixtures only. **Not private production ingestion,
not access-control software and not a public credit release.** Do not wire this
into an API, worker, public graph, global search, public profile, publication
or notification. Implementation of security gate [#202](https://github.com/dhuzard/oratlas/issues/202)
and workspaces [#204](https://github.com/dhuzard/oratlas/issues/204) is required
before any real private data is processed.

The adapters emit `oratlas.source-credit-observations/0.2.0`. It is deliberately
**not** `oratlas.private-cross-finding/0.1.0`. An upstream paper/roster/review
document cannot create an ORAtlas researcher identity, grant project membership,
establish a cross-project hypothesis, confirm a scientific relation, establish
ORAtlas TRUST, imply authorship or assign CRediT roles on a new finding.

## Pinned producer fixtures

| Producer         | Exact merged commit                                                                                                                   | Native contract                           | Tested fixture                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| Diggypaper       | [a34d18f](https://github.com/dhuzard/diggypaper/commit/a34d18f752377b2a6df01555d1963b2a43c0dca9)                                      | `finding-credit-companion/0.1.0`          | `diggypaper/credit.json` plus its **five actual packet files** |
| CRT              | [a19a8dc](https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge/commit/a19a8dc90ddbf93c06d6ab050aaad3a00d28a262) | `comprev.contributorship/1` private       | `crt/credit.json` plus native claim graph                      |
| ORCID Playground | [ff5aff9](https://github.com/dhuzard/orcid-playground/commit/ff5aff93cb34620f3f2500f709259aa0134c24f2)                                | `orcid-playground/roster-assertion` 0.1.0 | `orcid/roster.json` plus the producer's reference reading      |

The exact pins also live in code as `SOURCE_CREDIT_PRODUCER_PINS`
(`@oratlas/contracts`); the 0.2.0 schema rejects output whose
`producerContract`/`sourceContractPinnedCommit` differ from the producer's pin.

### Byte pin manifest and how it was checked

`packages/knowledge/src/fixtures/source-credit-interop/PINS.json` lists every
upstream file shipped there (13 files) with its upstream repository, commit,
upstream path, SHA-256 and byte length. The offline test suite re-hashes every
file and fails if a byte changes, or if an upstream file is added without a pin.
No test touches the network.

On 2026-10-19 all 13 files were compared read-only with their pinned upstream
bytes and matched exactly:

- **Diggypaper** (7 files) and **CRT** (3 files): `git show <commit>:<upstreamPath>`
  in local clones of the producer repositories.
- **ORCID Playground** (3 files): HTTPS GET of
  `https://raw.githubusercontent.com/dhuzard/orcid-playground/<commit>/<upstreamPath>`.
  `orcid/roster.json` is `tests/fixtures/roster/demo-export.json` and
  `schemas/orcid.roster.schema.json` is `schema/roster-assertion.schema.json`.
  `orcid/candidate-contacts.json` (the producer's `candidate_contacts` reading
  of the same export) was added in this change. The earlier version of this
  document said the ORCID files had not been re-compared. They have now been.

To re-check, for each `files[]` entry in `PINS.json`, fetch
`<commit>:<upstreamPath>` from the named repository (`git show` in a clone, or
the raw exact-commit URL above) and compare `sha256`/`bytes`. Never modify the
producer repositories or the pinned fixture bytes; a producer change means a new
pin, new goldens and a new adapter review.

## Runtime checks are a subset, not the native validators

Each adapter's Zod projection enforces the frozen closed shape
(`additionalProperties: false` → `.strict()`), required constants (for example
Diggypaper `credit_semantics.implies_authorship: false` and role vocabulary, CRT
`visibility: private`, `source_curation.review_authorship: false` and
non-CRediT-eligible agent labels, ORCID `access_effect`), source identifier
formats, the enumerated CRediT labels/slugs, the ORCID MOD 11-2 checksum, and
size bounds. It also ports the identity/consent/privacy rules from the native
validators that an importer relies on (below). It is **not** a replacement for
Diggypaper `fcc_validate.py`, CRT `validateCompanions` or ORCID
`roster.validate_export`: run each native validator on the raw bytes before any
producer-to-service ingestion. Also, the time-of-use expiry of a Diggypaper
handoff (`expires_at` against "now") is the caller's check. The adapters are
deterministic and never read the clock.

Adapter bounds stricter than a native schema: every carried string ≤ 500
characters, document ≤ 3 MB, arrays bounded (for example ≤ 10 000 entries,
≤ 500 passages/assessments per finding). Exceeding one is `source-schema-incompatible`
or `source-oversize`, never truncation. Empty source strings that the native
schema allows in nullable text fields (`reason`, `cite_key`, legacy `label`) are
carried as `null`.

## 0.1.0 → 0.2.0 migration

`oratlas.source-credit-observations/0.1.0` (`sourceCreditObservationsSchema`,
`SourceCreditObservations`) is kept unchanged in `@oratlas/contracts` as a
legacy contract. `adaptDiggypaperCredit`, `adaptCRTContributorship` and
`adaptOrcidRoster` now return `SourceCreditObservationsV2`
(`sourceCreditObservationsV2Schema`). The two versions are explicitly gated: each
schema rejects the other's `schemaVersion`. A consumer holding either uses
`sourceCreditObservationsAnyVersionSchema` and branches on `schemaVersion`.
There is no automatic down-conversion, because 0.2.0 → 0.1.0 would silently drop
the facts 0.2.0 exists to keep. The only consumers at the time of the change were
the adapter tests and the names-only private-import guard.

| 0.1.0                                                         | 0.2.0                                                                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| readable ids joined with `:` / array index                    | `<prefix><channel>:<sha256 of canonical JSON tuple of native ids>`: collision-free, permutation-invariant                                               |
| named `sourcePersonId` = Diggypaper contribution id           | `sourceAssertionId` = native contribution/assertion id; `person.sourcePersonId` only for real person ids (CRT), else `null`                             |
| `sourceOrcidStatus`/`verificationRef`                         | `person.orcid { id, sourceStatus, nativeStatus, verificationMethod, verificationRef, verifiedAt }`, schema-checked for status/evidence agreement        |
| `disclosureBasis: string[]`                                   | `sourceDisclosure` (Diggypaper consent/authorization/membership/consent ref/blinding, or CRT `public`/`reason`/`approvedFields`/`approvalIds`)          |
| evidence `sourceStatus: "reviewed-mapping:<claim>:<ref>"`     | `nativeBinding` + `mapping { claimId, decisionRef, mappedAt, claimDisclosure }`                                                                         |
| `sourceRights: "source-native-declared"` / redistribution     | `sourceRights` union: Diggypaper paper license/redistribution/full-text + packet licenses, or CRT `passageDisclosure`                                   |
| `passageIds` + `quoteSha256` parallel arrays                  | `passages [{ passageId, quoteSha256, quoteState }]`; `sourceAssessments [{ protocol, status, curatorRef, assessedSnapshotSha256 }]`                     |
| `nativeOriginId`/`nativeVisibility`                           | `nativeOrigin { originId, visibility, disclosure }`; Diggypaper visibility is the packet `access_scope.level`                                           |
| production `runId` (CRT agent id)                             | `sourceAgentId` (CRT) vs `runRef` (Diggypaper `run_ref` only); plus `agentType`, `softwareProducer`, `legacyAuthorId`                                   |
| roster members and contributions mixed in `candidateContacts` | `candidateContacts` (members with ORCID status/assertions, membership, person assertion) and `candidateCreditClaims` (output DOI/rights/assertion)      |
| —                                                             | `sourceDocument` provenance block per producer; `sourceLegacyRoleLabels`; report `legacyRoleLabels`, `producerDeclaredOmissions`, `omittedSourceFields` |

## Neutral representation and irreversible distinctions

- **Human contributions** (`assertions`): source capacity, exact target, human
  CRediT role (normalized only from a known role) with the original label,
  degree, declaration ref and role URI, source status, source decision ref,
  declaration kind and time, source disclosure facts.
  `destinationStatus: not-adjudicated` ALWAYS. Original publication authorship
  and source curators are not authors of a new cross-project finding.
- **Identity kinds stay distinct:** `named` (displayed only because the source
  disclosed it), `pseudonym` (`refKind: source-native-pseudonym`, never given a
  display name) and `withheld` (no name, pseudonym or ORCID). Bibliographic
  authors of cited works (`citedWork.authors`, `authorsAre:
bibliographic-citation-metadata`), CRT source curators (`sourceAssessments[].curatorRef`)
  and CRT contributors (`assertions`) are separate fields that never merge.
  Source-claimed and source-verified ORCIDs keep the producer's own status. No
  ORCID ownership check is performed (`accountVerification: not-performed`).
- **Evidence provenance:** exact finding id/revision, finding origin, snapshot
  ref and SHA-256, the native Diggypaper credit entry id (`sourceEntryId`;
  `null` for CRT, which has none, and never part of an observation id), packet
  id and manifest-bytes SHA-256, Phase 2 finding and
  lineage digests where recorded, passages and quote hashes, assessment
  protocol/status. The DOI is citation metadata. A `10.5555/` example DOI carries
  `doiIsExample: true` and is never an outbound link. Nothing here is a support,
  independence or scientific-verification decision (`oratlasAdjudication: none`).
- **Software provenance** (`production`): a separate software channel with
  native agent type (`software`, `ml-model`, `software-agent`), name, version,
  producer, activity and native agent id or run ref. Agents never get a human
  CRediT role, ORCID or person id.
- **Legacy labels** (`sourceLegacyRoleLabels`, CRT only): verbatim label,
  field, position, level, the **source's** own mapping and eligibility. ORAtlas
  never maps them. `Statistics` stays `sourceMapping: unmappable`,
  `sourceMappedRole: null`.
- **Roster candidates:** ORCID Playground members are possible contacts and
  contributions are credit claims to review (`confirmedByImport: false`), _never_
  authenticated ORCID accounts, invitations, project memberships or confirmed
  ORAtlas contribution. A local group role is never a CRediT role.
- **Disclosure:** `visibility: private-adapter-output`, `accessEffect: none`,
  `oratlasDisclosure: not-authorized`. Source `public`, `confirmed`, `verified`
  are retained as **source assertions**, not destination permission, personal
  approval or evidence validation. A CRT `disclosure.public: false` contributor
  stays named inside this private output, as in the source companion. It is
  counted as withheld; ORAtlas neither erases nor releases that identity.

## Report: units, overlap and omissions

- `accepted`: number of emitted observations in `assertions`, `evidence`,
  `production`, `candidateContacts` and `candidateCreditClaims` (0.1.0
  semantics). One Diggypaper contribution with _n_ CRediT roles emits _n_
  assertions (one capacity-only assertion when it has none). One CRT
  source-credit finding emits one evidence record **per claim**.
- `withheld`: emitted records the source marks withheld or non-public. Diggypaper:
  assertions with a withheld/withdrawn person. CRT: assertions of a non-public
  contributor plus evidence from a private origin or non-public claim. It
  overlaps `accepted`, and its unit is records, not people.
- `unmappable`: unmapped CRediT roles (which are _also_ accepted, with `role:
null`) plus non-authoritative source records that are **not** emitted (CRT
  relation proposals, ORCID project references). Because every pinned producer
  enumerates CRediT roles in its frozen schema, an unknown role label now fails
  closed as `source-schema-incompatible` rather than reaching this counter.
- `legacyRoleLabels { preserved, sourceUnmappable, sourceCreditIneligible }`:
  counted separately from `accepted`.
- `producerDeclaredOmissions`: what the producer itself declares omitted,
  verbatim: Diggypaper `export_status` (state, withheld counts, reasons) or the
  ORCID redaction policy and excluded-output reason codes. ORAtlas never re-counts
  these. CRT has none (`null`).
- `omittedSourceFields`: stable codes for source fields this adapter
  deliberately does not carry (data-driven where the field is optional):

| Code                                                            | Why it is not carried                                                                                    |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `diggypaper.audience.purpose`                                   | free-text handoff purpose; minimization                                                                  |
| `diggypaper.packet.assessment-reviewer-refs-and-rationales`     | a packet reviewer pseudonym can belong to an assessor the companion **withholds**; never re-identify one |
| `diggypaper.packet.finding-statement-context-and-review-states` | scientific content and source review/verification levels are not credit and not ORAtlas verification     |
| `diggypaper.packet.paper-title-and-non-doi-identifiers`         | citation display data; DOI and authors are kept                                                          |
| `diggypaper.packet.passage-quote-text`                          | quote hash and quote state are kept; text stays under source rights                                      |
| `crt.contributors.credit-statement`                             | free text derived from the structured assertions that are kept                                           |
| `crt.source-origins.project-ref-and-title`                      | private project metadata never leaves the source companion                                               |
| `crt.relation-proposals`                                        | proposals are not authoritative edges (also counted in `unmappable`)                                     |
| `orcid.group.name-and-assertion`                                | group display name; group local id and creator are kept, and the assertion is still checked              |
| `orcid.outputs.title`                                           | output display data; DOI, rights and assertion are kept on credit claims                                 |
| `orcid.outputs.without-credit-claims`                           | an output is carried only through a credit claim, never as credit by itself                              |
| `orcid.project-references`                                      | proposed projects never grant access (also counted in `unmappable`)                                      |

Error values are stable codes (`SourceCreditAdapterError`); adapter and
normalized-output failures never include names, ORCIDs or source excerpts.
Ordering is deterministic: channels are sorted by observation id, set-like arrays
(ids, approval ids, redaction lists, reasons) are sorted, and author lists keep
source order. `sourceDocumentSha256` (and the roster's own digest) legitimately
change when the source bytes or array order change.

## Fail-closed rules beyond the frozen JSON Schemas

- **Diggypaper:** packet manifest bytes digest = `packet.packet_digest`; all four
  artifact SHA-256/bytes/record counts; latest finding revision only; paper,
  origin, snapshot ref/digest, passages and assessments bound to the packet;
  audience ⊆ packet access scope; non-member audiences need an approved finding
  and redistributable rights. From `fcc_validate.py`: withheld status with a
  visible identity, CRediT roles on inactive (`withheld`/`disputed`/`withdrawn`)
  contributions, duplicate roles, assessor capacity/blinding/assessment binding
  and pseudonym agreement with the packet, disclosed identity only with granted
  consent + authorization + active membership + `consent_ref`, never for a
  blinded/unknown review or inactive status, ORCID verification ⇔ proof and
  checksum, a production agent named as a person, and audience/release/export-status
  header consistency. Withdrawn credit is emitted as `withheld` even for a
  pseudonym (conservative). Packet reviewer refs are not carried (see above).
- **CRT:** contributor/assertion/origin/agent uniqueness, agent ids distinct from
  person ids, `role`/`role_label`/`role_uri` agreement, ORCID checksum and
  verified ⇔ verification record, status ⇔ `status_ref`, legacy labels bound to
  contributors and unique per subject/field/position, origin ⇔ packet binding,
  a finding never re-bound to another packet or listed twice per claim, unique
  passages/assessments per finding, optional exact claim-graph bytes.
- **ORCID Playground:** canonical digest; consent granted by the group creator;
  revoked consent carries a revocation time and **no** members, outputs,
  contributions **or project references**; granted consent has no revocation
  time; `redaction.member_fields` is enforced (a non-null `orcid`,
  `display_name` or `local_role` that was not selected is
  `roster-redaction-contradiction`, even when the document is rehashed);
  checksum and URI agreement; one member per ORCID; an offline roster never
  carries an OAuth-verified iD, a non-`listed-member` membership or **any**
  `external-verified` assertion (group, person, membership, ORCID, output,
  contribution, project reference); on an external platform those need
  `external-verified` evidence with a reference; contribution references and
  provenance (`source-declared` needs a reference, `curator-confirmed` a named
  curator); project references only when redaction says `included`, and a URL only
  with sharing approval. The frozen schema allows `""` in assertion
  `evidence.source_record_version`/`reference` and member `display_name`/`local_role`.
  The digest and redaction checks run on the original values (an empty but
  unselected member field is still a contradiction). Then exactly these empty
  strings become `null`, before the other rules and before output. So an empty
  reference never counts as verification or provenance evidence, and a credit
  claim's `declarationRef` always equals its assertion's reference. No other
  string is trimmed, and the neutral 0.2.0 contract still rejects empty strings.

## Answers to the earlier producer questions

Reading `fcc_validate.py` at the pin answers the questions previously raised
with Diggypaper:

- `withheld` status on a disclosed contributor is invalid there
  (`withheld-status-inconsistent`). A disclosed identity on `disputed`/`withdrawn`
  is invalid too (`inactive-assertion-disclosed`). The adapter now fails closed
  instead of silently dropping the name.
- `confirmed` with `consent_ref: not-available` is invalid for a **disclosed**
  contributor (`consent-missing`) and valid for a pseudonymous/withheld one. The
  adapter rejects the first and keeps the `source-confirmed-without-decision-ref`
  flag for the second (as in the pinned fixture's `project-team` credit).
- CRT: `lineage_sha256` and per-finding `manifest_sha256` are still carried as
  exact bindings but not recomputed (lineage/packet bytes are not inputs).
- ORCID Playground: no producer gap was found. ORAtlas previously under-enforced
  the frozen rules (member-field redaction, ORCID-assertion basis, revoked
  project references), and that is now fixed on the ORAtlas side.

Producer contracts stay frozen; a producer opens a PR only for a demonstrated
fixture/contract gap. Compatibility threads:
[Diggypaper #55](https://github.com/dhuzard/diggypaper/issues/55#issuecomment-6261004222),
[CRT #17](https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge/issues/17#issuecomment-6261005185)
and ORCID Playground #9.

## Goldens

`fixtures/source-credit-interop/golden/{diggypaper,crt,orcid}.observations.json`
are the complete normalized outputs (CRT with claim-graph bytes supplied). The
test compares the serialized adapter output with these files byte for byte.
Regenerate them only deliberately, then review the diff:

```bash
UPDATE_SOURCE_CREDIT_GOLDEN=1 pnpm exec vitest run packages/knowledge/src/source-credit-adapters.test.ts
```

## Production integration is explicitly blocked

This work does not implement user/project ACL, project source authorization,
revocation/cached-result invalidation, connector tokens, identity confirmation,
scientific validation, contributor consent, disclosure approval or public
release. A future project-scoped adapter MUST authorize both source access and
cross-project processing _before_ loading private inputs, use a verified
authentication principal, and enforce individual/controller consent before
publishing any attribution. See [#202](https://github.com/dhuzard/oratlas/issues/202),
[#203](https://github.com/dhuzard/oratlas/issues/203),
[#204](https://github.com/dhuzard/oratlas/issues/204),
[#205](https://github.com/dhuzard/oratlas/issues/205),
[#206](https://github.com/dhuzard/oratlas/issues/206),
[#207](https://github.com/dhuzard/oratlas/issues/207).
