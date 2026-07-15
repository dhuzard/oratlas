# Federated review exchange

ORAtlas implements the COAR Notify 1.0.1 **Request Review** and **Announce Review** patterns so
repository and review services can coordinate without sharing credentials or adopting one central
platform. The implementation deliberately separates receipt, editorial intent and publication.

## Inbox

`POST /api/federation/inbox` accepts `application/ld+json` or `application/json`. New delivery
payloads remain non-public while `pending` and stay non-public if `rejected`. Only editor-`accepted`
deliveries appear in the public LDN container or resolve through a public notification URL.

`GET /api/federation/inbox` returns at most 50 accepted notification URLs by default. Clients can
request `limit=1..100`; when another page exists, the response includes a deterministic opaque
`cursor` in a `Link: <...>; rel="next"` header. Following that link avoids silent truncation while
keeping traversal bounded.

The framework-free `@oratlas/federation` package validates the review-action type, actor, origin,
target, scholarly object and content-file metadata. Its JSON-LD profile requires exactly the pinned
ActivityStreams context followed by the COAR Notify context (the legacy COAR context is also
recognized in that slot). Additional mutable or nested remote contexts are rejected. Extensions can
use the supported terms from those pinned vocabularies or absolute-IRI property names; unknown bare
terms and additional JSON-LD keywords are rejected. Extension trees contain JSON-safe values only
and fail closed beyond 64 levels or 10,000 total nodes. Atlas never dereferences a context. Only
messages addressed to the configured ORAtlas inbox are accepted.

External URLs are **identifiers only**. Receipt never fetches an actor, inbox, preprint or content
file, so a notification cannot turn the service into an SSRF proxy. Requests are byte-limited and
IP-rate-limited. Canonical payload bytes and their SHA-256 hash are append-only; replaying an
activity id with identical bytes is idempotent, while different bytes under the same id fail closed.

Every new message enters `pending`. An editor can accept or reject it from the dashboard with an
attributable note. Acceptance records willingness to coordinate; it does **not** accept a submission,
create a review, endorse the resource or publish anything.

## Announcing an archived review

An editor uses `POST /api/reviews/{slug}/versions/{versionId}/federation/announce` with the activity
id of an accepted inbound **Request Review**. Atlas derives the reviewed resource and reply target
from that preserved request; callers cannot mint an unrelated association. The review object is the
immutable Atlas version landing page and the reviewed `context` remains the repository resource from
the request. Real version DOIs are included as `ietf:cite-as`; example identifiers are withheld.

The endpoint persists an immutable `prepared` outbound activity and audit event, and returns JSON-LD,
but performs no delivery. Operators can sign and deliver that payload through their own controlled
outbound worker. Only explicitly published or withdrawn versions of published reviews are eligible;
tombstoned, draft, and unknown states fail closed.

## Trust boundary

COAR Notify provides interoperable envelopes, not proof that an actor controls a URI or that a
review is scientifically valid. ORAtlas preserves every inbound assertion as untrusted source data,
requires human triage, and records all resolutions in the audit log.
