# ORAtlas integration trains

This plan replaces item-level pull-request review with ORA-scoped commits inside four
outcome-based integration trains. Source PRs remain immutable review evidence until their
replacement train is verified; they are then closed as superseded, never deleted.

Decision authority: Damien Huzard (`dhuzard`), 2026-07-22.

## Ordered branch graph

```text
main
└── integration/reliability-ops
    └── integration/core-trust
        └── integration/challenges-governance
            └── integration/external-exports
```

Merge and retarget in that order. Only the incremental train diff is reviewed. At most two
trains should be under active human review at once.

## Train 1 — Reliability, operations, and documentation

Branch: `integration/reliability-ops` · Base: `main` · Draft PR: #102

| ORA     | Source PR | Frozen head                                |
| ------- | --------: | ------------------------------------------ |
| ORA-B01 |       #78 | `a5e52dae7e308fd11eb0d46a195d423432a99410` |
| ORA-B02 |       #93 | `6a1924643b37e429584ab87531346d597cb4b14d` |
| ORA-J02 |       #82 | `32ccc2e63cf5e6b508f98b49341c5dba086b5223` |
| ORA-K01 |       #79 | `ca19ccee6e1c02fbab77e910017a12db1110c3b2` |
| ORA-K02 |       #77 | `4d8a0258a8e596d888408b2f658293f3cc40caf7` |
| ORA-K03 |       #83 | `ca4d7bb970ebf5d4299dfa433ae279cbd3442a06` |
| ORA-L01 |       #88 | `eaaf3a50d965468e2f15f49d6d675d57a8051c11` |
| ORA-L02 |       #81 | `a1724c13e0db2bb569de911533da6c2be649f940` |

Apply CI/tooling commits first, operational drills next, and planning reconciliation last.

### Imported functional commits

| ORA     | Source commits                  | Integrated commits              |
| ------- | ------------------------------- | ------------------------------- |
| ORA-B01 | `608c787`, `a5e52da`            | `5b2440b`, `ec1773d`            |
| ORA-K01 | `40d2b66`                       | `d2426a7`                       |
| ORA-B02 | `48eb5e9`, `d7400a3`, `6a19246` | `3896910`, `7cae9de`, `ee1bbeb` |
| ORA-J02 | `e0a7e10`, `32ccc2e`            | `3ed5d79`, `c331f76`            |
| ORA-K02 | `8120062`                       | `e4e9d45`                       |
| ORA-K03 | `33c87f2`, `ca4d7bb`            | `bf042f4`, `396b0a6`            |
| ORA-L01 | `d50f213`                       | `be3225f`                       |
| ORA-L02 | `54422dd`                       | `2f75de3`                       |

PR-link-only commits were omitted. Development-log append conflicts were combined; contributor
guidance and backlog state were reconciled to this train policy in a train-level commit.

## Train 2 — Core archive and TRUST

Branch: `integration/core-trust` · Base: `integration/reliability-ops` · Draft PR: #103

| ORA     | Source PR | Frozen head                                |
| ------- | --------: | ------------------------------------------ |
| ORA-D01 |       #95 | `32815b4b2d19fb709fbb5bcf9a783f4241f37d69` |
| ORA-D03 |       #80 | `42f6f1337f6acee29e7910a242203a6b9cf612fa` |
| ORA-F01 |       #97 | `ae414d7b3bbeb46b7dd52422551465aa92843e3a` |
| ORA-G01 |       #85 | `f64da89047a153d91c9fb0f7ad6692213f422a00` |
| ORA-H01 |       #76 | `f4add7e97902e7cf77c33b66266f8a5bee3177cc` |
| ORA-H02 |       #86 | `a7a1943f2cfcaa1e6ac801f2a6335450962571eb` |

Resolve review DTO, TRUST presentation, editorial-panel, and stable-link overlaps once on this
train. Complete arrays remain canonical and no cross-assessment aggregate is introduced.

### Imported functional commits

| ORA     | Source commits                                                   | Integrated commits                                               |
| ------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| ORA-D01 | `1a02eea`, `b89b7db`, `b2ad8e0`, `90f39fb`, `b5f65c4`, `32815b4` | `b05e5f7`, `c03716c`, `5f3c72e`, `5c0be38`, `a49c830`, `261ea40` |
| ORA-D03 | `01fb266`, `5712bea`, `1d5d4c3`                                  | `457e88c`, `4fb3713`, `2b59ac5`                                  |
| ORA-F01 | `b832eb3`, `ae414d7`                                             | `09d3ea9`, `35e5972`                                             |
| ORA-H01 | `7d5d0e2`                                                        | `c423bcb`                                                        |
| ORA-H02 | `1617f4f`, `cd07a8c`, `a7a1943`                                  | `cb6ac74`, `e767ba8`, `105ac5e`                                  |
| ORA-G01 | `c5f1c78`                                                        | `47735f4`                                                        |

PR-link-only commits were omitted. Integration commit `0aced9b` reconciles complete profiles,
fail-closed per-assessment badges, pagination, singleton compatibility, and stable deep links.

## Train 3 — Challenges and editorial governance

Branch: `integration/challenges-governance` · Base: `integration/core-trust` · Draft PR: #104

| ORA     | Source PR | Frozen head                                |
| ------- | --------: | ------------------------------------------ |
| ORA-C01 |       #91 | `31fa0662cdea21d3ddfa78180d26e6cfceb2e631` |
| ORA-E01 |       #98 | `4f7d121fac85e0ff6a9aac0d53989970df7a59b6` |
| ORA-J03 |       #99 | `27a47fd11440bec8b641044d18d45fe9e485e732` |
| ORA-E02 |      #100 | `bcbeaa2972587423b1a3128c8968bb48b612c586` |
| ORA-E03 |       #87 | `4681386b82b7fe7346fe3c30d642b9bb19b79e44` |
| ORA-E04 |       #90 | `9dbce58bd0c13a85db811e45db9290d6fc57eb98` |
| ORA-J01 |       #72 | `120c43fcff9bb31dd3870ad1997a69a88f031e5f` |
| ORA-I02 |      #101 | `daeae74e02ec62e4d9285e6bf7bd7b4dd89d3deb` |
| ORA-F03 |       #89 | `9bd185a9db3967a59f12e57ea091128f8511a2f1` |

Preserve the tested E01 → J03 → E02 lifecycle order. Apply I02 before the final visibility
audit. This train implements the ratified authority and public/private boundaries in
`ORATLAS_DECISIONS.md` §§5, 6, and 9.

### Imported functional commits

| ORA     | Source commits                             | Integrated commits                         |
| ------- | ------------------------------------------ | ------------------------------------------ |
| ORA-C01 | `e129f04`, `6a9024b`, `31fa066`            | `3ffe379`, `73e7acc`, `430afc8`            |
| ORA-E01 | `4d47ddc`, `84d5d44`, `9a96918`, `4f7d121` | `d663d6a`, `42eb18a`, `d840cf4`, `46700a9` |
| ORA-J03 | `9ef43b9`, `f2c2fdc`, `e732061`, `27a47fd` | `2d6ee56`, `a53129c`, `33eca93`, `b25c1ed` |
| ORA-E02 | `ec0cd06`, `bcbeaa2`                       | `1ddbbef`, `fe8f162`                       |
| ORA-E03 | `42a7985`, `4681386`                       | `d0c4ce9`, `bfe3527`                       |
| ORA-E04 | `6ebf430`                                  | `53045a6`                                  |
| ORA-J01 | `9615909`, `06e5995`, `120c43f`            | `c0b991a`, `4f093e9`, `7335c40`            |
| ORA-I02 | `f7a7272`, `d1ef39b`, `daeae74`            | `d4414d1`, `33528cd`, `73673fe`            |
| ORA-F03 | `aee0f80`, `9bd185a`                       | `456c2b3`, `8111f90`                       |

PR-link-only and inherited ancestor commits were omitted. The integrated result retains complete
assessment arrays and stable links from Train 2, the E01 → J03 → E02 lifecycle order, and the
ratified public/private visibility boundary.

## Train 4 — External fixtures, exports, and decision-driven features

Branch: `integration/external-exports` · Base: `integration/challenges-governance` · Draft PR: #105

| ORA     | Source PR | Frozen head                                |
| ------- | --------: | ------------------------------------------ |
| ORA-A01 |       #96 | `a28ee544f873f11a1782f25d70ba4338805b6179` |
| ORA-A02 |       #73 | `d02fb21cbaa1d372672981166a9a8f8d4548fe55` |
| ORA-A05 |       #74 | `2e4ce38d73eeec29a11fb4481733e79286bb7edd` |
| ORA-D04 |       #75 | `5e91d350ec29d56d961a3cbb09b3697de40766dc` |
| ORA-C02 |       #84 | `b978ac4644d5b3e367a7b7f0d91484fcf4ba325b` |

New ORA-scoped commits on this train implement the now-unblocked ORA-A03, ORA-A04, ORA-D02,
ORA-F02, and ORA-I01. ORA-G02 remains outside this consolidation because it has no source PR
and requires federation coordination.

### Imported functional commits

| ORA      | Source commit(s)     | Integration commit(s)           |
| -------- | -------------------- | ------------------------------- |
| ORA-A01  | `c31d0d5`, `a795cdc` | `65c5981`, `e729898`            |
| ORA-A02  | `9c1ee4c`            | `c9ee6ef`                       |
| ORA-A05  | `3a3ed04`            | `d1ac54d`                       |
| ORA-C02  | `1ab175e`            | `b4840ea`                       |
| ORA-D04  | `3aaa2be`            | `8162d67`                       |
| ORA-A03  | —                    | `c0c2d36`                       |
| ORA-A04  | —                    | `373b1ad`                       |
| ORA-D02  | —                    | `ce8a808`, `6b74583`            |
| ORA-D02a | —                    | `22b6fc0`                       |
| ORA-F02  | —                    | `20a82cb`, `02e1762`, `0e2b70f` |
| ORA-I01  | —                    | `22eca5e`                       |

Integration-only reconciliation and review fixes are retained in this train. ORA-D02 includes
claim-citation adjudication challenges; ORA-D02a completes node-relation adjudication challenges
with a non-fictional `NodeEdgeProposal` container.

## Import and retirement rules

1. Import functional commits and preserve authorship and ORA identifiers.
2. Exclude PR-link-only commits; reconcile backlog and planning documents once per train.
3. Record source head, source commits, integration commits, decisions, conflicts, and tests in
   the train PR description or an appended manifest section here.
4. Compare source and integrated patches before retiring a source PR. Any intentional delta
   must be documented.
5. Run formatting, lint, typecheck, unit/integration tests, schema checks, PostgreSQL, and e2e
   once on the complete train.
6. Require one semantic/data-integrity review and one security/privacy/integration review.
7. After the integration PR is green, comment on each source PR with its replacement and
   close it as superseded. Reopen it if the mapping is later found incomplete.
8. Human review focuses on decisions, migrations, public contracts, and material risk rather
   than re-reviewing every source diff line by line.
