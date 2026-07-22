# TRUST disagreement and adjudication

ORAtlas detects disagreements only among current assessment-lineage heads for one exact
claim–citation or node-relation subject and one exact `protocolVersion`. Two or more different
explicit ordinal ratings on a criterion create a disagreement. Missing, `not-assessed`, and
`not-applicable` values are reported separately as coverage gaps; malformed stored criteria fail
closed. No cross-protocol comparison, translation, weighting, averaging, or preferred-assessor
ranking occurs.

The disagreement hash binds the subject, protocol, sorted current assessment identifiers and
their resolved semantic hashes, and the deterministic criterion report. An adjudication is a
separate append-only record. Its references retain every assessment identifier and resolved hash;
its outcome hash also binds the public adjudicator login, private role/rationale hashes, public COI
snapshot, and any ADMIN override. Database constraints enforce subject/outcome/COI shapes, and
database triggers reject adjudication/reference updates or deletes in SQLite and PostgreSQL.

Editors, administrators, and explicitly designated TRUST adjudicators may adjudicate. Actual
direct involvement—being an assessor, review contributor, or node-submission submitter—requires
recusal. Only an ADMIN may override that recusal, and the override requires a public
`conflict-declared` snapshot. A COI declaration without direct involvement is immutable public
provenance, not by itself a loss of authority.

Current lineage heads alone drive the open queue. When a referenced assessment is superseded, the
historical adjudication is rechecked against the historical row and remains visible and valid, but
it does not close a newly detected current disagreement. Public projections expose the outcome,
time, adjudicator login, tri-state COI, optional ADMIN override, and integrity hashes. They exclude
the rationale, role snapshot, and internal user identifiers. Scholarly JSON and RO-Crate preserve
the independent assessments, detected disagreement, and adjudication as distinct records.

Claim–citation adjudications may be challenged through the existing review-version lifecycle. The
challenge subject binds the exact adjudication id, disagreement hash, and outcome hash and links
back to the public adjudication anchor; later integrity checks re-resolve those values. The current
Challenge container still cannot represent node-relation adjudications because it requires a
`ReviewVersion`. That node-only extension is tracked as ORA-D02a rather than attaching a challenge
to an unrelated review.
