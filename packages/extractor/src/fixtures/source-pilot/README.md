# Public source import preview (#264)

These are exact bounded public repository captures, collected on 2026-10-29 with
`scripts/capture-github-fixture.ts`, without cloning or executing producer code.
Replay is offline using `createCapturedFixtureTransport`. `hashes.json` records
each captured file's SHA-256 and the canonical capture-manifest digest; fixture
verification rejects changed bytes or changed identity before inspection.
The local `.gitattributes` disables checkout newline conversion for these captures.

| Example           | Immutable repository id | Commit                                   | Capture-manifest SHA-256                                         |
| ----------------- | ----------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| DiggyPaper / NTS  | 1437255500              | b957ced01f0ff80fefcb08e5bebbdfe321383863 | e535a01d649ba483dc23cce25294d168e1e7084cf0c83e577a3bfbee12ba4c95 |
| Murmuration / HCM | 1437035846              | a906c5f15e77b8a4ac0671c9df15f75b8095029f | 39e96a9d7cbb30f0e4d7ae6e1a8b2562eecd125db5aa90896397e6e414ddc37c |
| HCM release v0.1.0 | 1437035846             | a906c5f15e77b8a4ac0671c9df15f75b8095029f | 9c6a1277b5fea5fa6710affb233f082cacdbdc2560295c4e34dd04fd83fa470b |

The additive `hcm-release/` capture selects the published release `v0.1.0`,
annotated tag object `b26d0f8fc90c137c4f990ab038a152fdda87ea44`, tree
`1df78fd454940b4d210748a0ebe6d171c43fe435`. GitHub release id `426624753`
was observed on 2026-10-29 at the public release endpoint (published
2026-10-28T12:12:36Z, neither draft nor prerelease); the fixture schema retains
the release URL/tag and immutable Git source binding, not the numeric release id.
Capture command:

```sh
pnpm capture:fixture --repo dhuzard/hcm-circadian-mouse-review --release v0.1.0 --out packages/extractor/src/fixtures/source-pilot/hcm-release
```

Its six captured files are byte-identical to the earlier default-branch capture.
The source-selection identity and manifest digest differ. The original pin remains
unchanged. Selecting the actual release avoids asserting release identity for a
default-branch selection; it does not add the missing full report/matrix bytes or
satisfy the separate full-acceptance prerequisite below.

CRT deliberately reuses `../ethical-debt-v0.1.0-trust-preview.3` unchanged:
repository id 1291083149, commit 955e2994e0c6a042be80851b2125c2064c211dcf,
capture-manifest digest 9f13f8dfc35cca0cf0a602b3304bcc0c9fe94e751c448d020b63e789f27abb23.
The current CRT head in #264 is a separate live observation, not this acceptance pin.

All three manifests declare review-manifest 1.0.0 and MIT. This declaration does
not license third-party article text. NTS source lineage uses
`comprev.oratlas-source-native-sidecar/1`, export 1.0.0, native TRUST rubric 2.0.0,
and `seip-support-v1` findings; those are source assertions. HCM provenance declares
Murmuration f14d167571a392979958fa4e2a8b33faf24b8d77 and contract commit
8fba7b16f4ca2c09d21d2be5ca1bfb94dd03b0fc. No producer protocol is rewritten.

## Observed scope and limits

- CRT replay is partial: 529 claims, 994 citations, 1392 relations and 1392
  source TRUST records. Existing uncaptured prose warnings remain visible.
- NTS capture and replay succeed: 4 claims, 4 citations, 4 relations, no TRUST
  records. Unlike the earlier live observation in #264, this capture fetched the
  bounded invalid-test fixture files without warnings. Those files remain inert;
  knowledge extraction uses manifest-declared paths only.
- HCM capture and replay succeed: 58 claims, 5 citations, 58 relations, no TRUST
  records. The bounded inspector does **not** capture `source/run/final_report.md`,
  `knowledge/oratlas/report.md` or `source/run/mapppp_bundle.json`. The completed
  report/matrix prerequisite is therefore not satisfied by this fixture alone.
  Exporter skip reasons are preserved in provenance; no config-only completion
  or full report acceptance is claimed.
- CRT's manifest declares Damien Huzard's ORCID 0000-0003-4820-7951 as contact and
  contributor. NTS and HCM manifests do not declare it. This test preserves that
  distinction; it performs no OAuth, account verification, identity merge or grant.
- The citation DOI sets do not overlap. No cross-source support, contradiction,
  replication or confirmation is inferred.

`source-pilot.integration.test.ts` replays all three sources, checks identities and
digests, and exercises byte tampering, stale capture identity, malformed/stale
lineage, candidate versus reviewed bindings, and rights-withheld passage metadata.
Negative variants exist only in test memory; producer bytes remain unchanged.
Rights tests check the existing metadata-only projection, not external packet
redistribution clearance. No external packet is fetched by replay.

Run: `pnpm exec vitest run packages/extractor/src/source-pilot.integration.test.ts`.

## Acceptance and rollback

Inspection is a read-only preview, separate from editorial acceptance and canonical
materialization. There is no database write, connector enablement, schema migration,
or production import in this slice. Full HCM acceptance requires a separately
reviewed exact-byte report/matrix capture. Authenticated editorial import remains a
separate workflow after all applicable gates.

Rollback removes this fixture directory and the new integration test. The existing
CRT release pin, production routes, database and canonical identities are unchanged.
New producer pins require a new reviewed capture; do not overwrite these bytes.
