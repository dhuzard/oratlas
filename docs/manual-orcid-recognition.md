# Manual ORCID recognition — bounded #203 implementation

Manual profile entry now requires a valid ORCID format **and checksum** in both
`POST /api/profile/orcid` and the underlying `setUserOrcid` operation. Invalid
identifiers are rejected before user or audit writes. Null still clears the
manual field; successful responses retain `{ orcid, verified: false }`. Global
bibliographic/source schemas are unchanged. The reusable checksum utility now
lives in the public contracts identifiers module; private source-credit contracts
import it there. The architecture guard still rejects private source-credit
exports in public application modules.

`apps/web/src/lib/manual-orcid-recognition.ts` also provides a pure injected
public-record recognition service with synthetic tests. An exact matching
`found` result produces `recognized` with `ownership: unverified`. An explicit
`not-found` means only that the injected lookup found no public record; it is
not proof that a person or identifier does not exist. Invalid identifiers cause
no lookup. A mismatched subject, malformed or overbroad result, exception or
unavailable lookup yields `inconclusive`, never verification or nonexistence.
No returned record can assert account ownership, identity-link verification,
authorship, credit, workspace membership or permission.

**The API lookup is not wired into the manual profile route.** No concrete HTTP
transport, OAuth exchange, credentials, persistence, new endpoint or session
policy is introduced. The injected lookup must enforce bounded timeouts and
map outages to `unavailable`; the pure service does not initiate network calls
or implement timeout scheduling. Approved I1's live public-record API check
remains incomplete until a reviewed provider/transport boundary is supplied.
The route imports the checksum schema only; it does not invoke recognition.

The existing identity-link foundations and S1 persistence design remain
separate. This change does not settle session-instance storage, retention,
unlink/reuse rules or the protected-response/provider-exchange ordering blockers
in `identity-persistence-session-design.md`. It does not activate private data
processing or change the D11/G1–G6 gates.

Validation covers synthetic recognition results, checksum failures, subject
substitution, failure classification, unchanged manual success/null responses,
and a real disposable SQLite regression proving an invalid service call writes
neither user data nor an audit record. The route unit test executes the real
route schema and callback with its existing lifecycle/authentication wrapper
mocked; it is not evidence of new CSRF or authentication behavior.
