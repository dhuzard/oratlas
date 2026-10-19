# Source-native credit interoperability — offline PR A (ORAtlas #209)

**Status:** offline mapping/fixtures only. **Not private production ingestion,
not access-control software and not a public credit release.** Do not wire this
into an API, worker, public graph, global search, public profile, publication
or notification. Implementation of security gate [#202](https://github.com/dhuzard/oratlas/issues/202)
and workspaces [#204](https://github.com/dhuzard/oratlas/issues/204) is required
before any real private data is processed.

The `oratlas.source-credit-observations/0.1.0` output is deliberately **not**
`oratlas.private-cross-finding/0.1.0`. An upstream paper/roster/review document
cannot create an ORAtlas researcher identity, grant project membership,
establish a cross-project hypothesis, confirm a scientific relation, establish
ORAtlas TRUST or assign CRediT roles on a new finding.

## Pinned producer fixtures

| Producer         | Exact merged commit                                                                                                                   | Native schema                             | Tested fixture                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| Diggypaper       | [a34d18f](https://github.com/dhuzard/diggypaper/commit/a34d18f752377b2a6df01555d1963b2a43c0dca9)                                      | `finding-credit-companion/0.1.0`          | `diggypaper/credit.json` plus its **five actual packet files** |
| CRT              | [a19a8dc](https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge/commit/a19a8dc90ddbf93c06d6ab050aaad3a00d28a262) | `comprev.contributorship/1` private       | `crt/credit.json` plus native claim graph                      |
| ORCID Playground | [ff5aff9](https://github.com/dhuzard/orcid-playground/commit/ff5aff93cb34620f3f2500f709259aa0134c24f2)                                | `orcid-playground/roster-assertion` 0.1.0 | `orcid/roster.json`                                            |

Exact original synthetic fixtures and source-native JSON Schemas are copied to
`packages/knowledge/src/fixtures/source-credit-interop/` with unchanged bytes.
Schema checks exercise the upstream closed data contracts. Runtime adapters
are **not** substitutes for the complete Diggypaper `fcc_validate.py`, CRT
`validateCompanions`, or ORCID `roster.validate_export` semantic validation:
before producer-to-service ingestion, run each native validator against the
original raw packet/companion. Never treat Zod's projected subset as complete
source authorization or scientific verification.

## Neutral representation and irreversible distinctions

- **Human contributions:** source capacity, exact target, human CRediT role
  (normalized only from a known role), original role label, source status,
  source decision/declaration reference, consent/blinding source facts.
  `destinationStatus: not-adjudicated` ALWAYS. Original publication
  authorship and source curators are not authors of a new cross-project finding.
- **Evidence provenance:** exact finding ID/revision; original packet ID and
  manifest-bytes SHA-256 where available; Phase 2 finding/claim graph digest
  and lineage digest where recorded; passage IDs, quote hashes and assessment
  refs. The source DOI or bibliographic author list is _citation metadata_,
  not proof of support, independence or authorship.
- **Software provenance:** separate software actor/channel with name, version,
  workflow activity and source run ID. No human CRediT identity or ORCID.
- **Roster candidates:** ORCID Playground entries are possible contacts and
  curator-/source-declared output roles only, _never_ authenticated ORCID
  accounts, invitations, project memberships or confirmed ORAtlas contribution.
- **Disclosure:** all normalized records have `visibility:
private-adapter-output`, `accessEffect: none`,
  `oratlasDisclosure: not-authorized` where applicable. Source-reported
  `public`, `confirmed` or `verified` is retained as a **source assertion**.
  It does not establish a destination permission, personal approval or
  evidence validation. Consent and controller release are independent.
- **Identity:** pseudonyms remain source-native pseudonyms and withheld names
  remain withheld; never invent a display name from a pseudonym or use a
  display name, DOI, ORCID or shared text as stable cross-system identity.
- **Loss report:** stable `accepted/withheld/unmappable` counts and reason
  codes, without leaking private content in errors. Native proposed
  relations and unrecognized roles cannot silently turn into evidence.
  Ordering of accepted entries is deterministic (source document digest changes
  legitimately if JSON bytes change).

## Checksum and provenance rules

- Diggypaper: packet SHA-256 is the SHA-256 of the **raw `manifest.json`
  bytes**. Verify all four artifact SHA-256 values, byte lengths and record
  counts against that manifest; resolve the finding/revision, paper and
  captured source snapshot, passages and native assessment refs. Never hash
  reconstructed JSON and pretend that is the original manifest.
- CRT: original `subject.claim_graph_sha256` refers to the review's claim
  graph bytes, **not** Diggypaper's packet manifest. The importer can
  optionally verify the exact graph bytes; otherwise report that they were
  not supplied. Keep source packet/lineage/finding SHA fields separately.
- ORCID Playground: the `digest.value` hashes the recursively sorted-key
  JSON export **without** its `digest` object, encoded as UTF-8.
  The roster remains opt-in, private-recipient-only and without access effect.

## Semantics that are not mapped losslessly

| Source semantics                                                                   | Behaviour in the neutral output                                                                                      |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Diggypaper credit with status `withheld` or `withdrawn`                            | Person is emitted as `withheld` and counted; a name present on the source record is dropped, never carried.          |
| Named Diggypaper contributor without granted person/controller consent or blinded  | Whole document rejected (`disclosure-not-authorized`); no partial identity is emitted.                               |
| Diggypaper `confirmed` credit with no `consent_ref`                                | Kept as source status; reason code `source-confirmed-without-decision-ref`. No decision reference is synthesized.    |
| CRediT label not equal to a canonical ID or label (case, spacing, dash style only) | `role: null`, `unmappable` incremented, `unmapped-credit-role`. Original label is not carried as a role.             |
| Diggypaper `degree: not-available`                                                 | `degree: null`.                                                                                                      |
| CRT `relation_proposals`                                                           | Counted as `unmappable`; never become evidence edges.                                                                |
| CRT `lineage_sha256` and per-finding `manifest_sha256`                             | Carried as exact bindings but **not recomputed** (lineage and packet bytes are not inputs). Claim graph is optional. |
| ORCID `project_references`                                                         | Counted as `unmappable`; never a project connection or access grant.                                                 |
| ORCID local `local_role`                                                           | Kept as `sourceRole`; never a CRediT role.                                                                           |
| Source `confirmed`/`verified`/`public`                                             | Source assertion only; `destinationStatus` stays `not-adjudicated`/`candidate-only`.                                 |

Error values are stable codes (`SourceCreditAdapterError`); adapter and
normalized-output failures never include names, ORCIDs or source excerpts.

## Fixture provenance check

Diggypaper `credit.json`, schema and the five `private` packet files, plus CRT
`contributorship.private.json`, `claim-graph.json` and the private schema, were
compared byte for byte with the pinned commits in the table above. The ORCID
Playground files were not re-compared from this review (repository not
available to it); re-check them against `ff5aff9` before relying on them.

## Upstream handoff

Compatibility checks were requested from each producer in
[Diggypaper #55](https://github.com/dhuzard/diggypaper/issues/55#issuecomment-6261004222),
[CRT #17](https://github.com/Neuronautix/ComputationalReviewTemplate_trust-knowledge/issues/17#issuecomment-6261005185)
and ORCID Playground #9. Producer contracts stay frozen; a producer opens a PR
only for a demonstrated fixture/contract gap. The intentional losses those
checks compare against are listed in the table above.

Gaps found while reviewing the adapters, for the producers to confirm rather
than assume:

- **Diggypaper:** whether `withheld`/`withdrawn` credits on a disclosed
  contributor, and `confirmed` with `consent_ref: not-available`, are valid
  under `fcc_validate.py`. ORAtlas withholds the name in the first case and
  flags the second.
- **CRT:** the adapter carries `lineage_sha256` and per-finding
  `manifest_sha256` but cannot recompute them without the lineage and packet
  bytes; a producer-side golden check covers that today.
- **ORCID Playground:** none identified.

## Production integration is explicitly blocked

This PR does not implement user/project ACL, project source authorization,
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
