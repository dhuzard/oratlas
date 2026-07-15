# Protocol Drift Radar

Protocol Drift Radar compares immutable protocol-registry snapshots with structured scope declared
by review claims. It opens neutral reconciliation proposals for population, outcomes, exclusions,
and analysis-plan differences. A proposal is a request for human review; it is never evidence of
misconduct and the system never infers author intent or rewrites a claim.

## Supported sources and provenance

- OSF registrations use the OSF v2 registration shape plus a complete, unique question-id/label map
  from the related registration schema and an explicit editorial category for every question. Atlas
  never derives scientific meaning from label keywords. Missing mappings fail closed; answers marked
  `unclassified` remain explicit provenance rather than being guessed or discarded.
- ClinicalTrials.gov uses the API v2 `protocolSection` shape: eligibility, outcomes, and study design.

An editor must provide the clean canonical registry URL, exact upstream version marker (ETag, data
version, or immutable timestamp), acquisition timestamp, and exact JSON payload. URLs with credentials,
queries, fragments, non-canonical paths, or mismatched payload ids fail closed. Atlas stores the raw
canonical JSON, OSF question metadata, a SHA-256 hash covering both, the normalized representation,
all JSON pointers, comparator version, server ingestion time, and an audit event. Reusing a source
version with different payload or question metadata fails closed. Replaying the same capture is
idempotent.

## Comparison and editorial workflow

Observed review fields come only from declared claim `scope`: `population`, `outcome`, `exclusions`,
and `analysisPlan` (with `method` as a backward-compatible analysis-plan field). Free text is never
silently classified. ClinicalTrials.gov trial design fields are recursively preserved with exact JSON
pointers as unclassified provenance, not mislabeled as a statistical analysis plan. Exact normalized sets produce no proposal; missing or
different sets produce a stable proposal id and retain pointers on both sides. Capture time and display
URL do not affect proposal identity.

Editors ingest snapshots and resolve proposals in the editorial dashboard. Mutations require a signed
editor/admin session, same-origin JSON, request-size and rate limits, strict schemas, and an attributable
resolution note. Public review and claim pages show source version, timestamps, hashes, proposal state,
and resolutions. Raw registry payloads remain server-side; normalized provenance is public through the
documented JSON endpoints.

Networking is deliberately outside ingestion. `@oratlas/protocols` exposes an injectable read-only
transport for acquisition; adapter/comparator tests use fixtures and never access a registry.
