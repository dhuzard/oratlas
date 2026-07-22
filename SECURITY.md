# Security policy

Open Review Atlas is a proof of concept, but it is built to be safe against the obvious classes of
attack given that it ingests untrusted, third-party repository content.

## Reporting a vulnerability

Please report suspected vulnerabilities through a
[private GitHub security advisory](https://github.com/dhuzard/oratlas/security/advisories/new)
rather than opening a public issue. Include a description, reproduction steps, and impact. We will
acknowledge and respond as soon as we reasonably can.

## Security properties (by design)

- **SSRF prevention.** Only canonical `https://github.com/{owner}/{repo}` URLs reach the network
  layer. Non-GitHub hosts, look-alike hosts, embedded credentials, `api.`/`raw.` hosts,
  localhost/loopback/link-local/private IPs, non-standard ports, and non-http(s) schemes are
  rejected before any request is made.
- **Bounded inspection.** Repositories are inspected via the GitHub API with explicit timeouts,
  a transport-level response-byte cap enforced while streaming, max file bytes, max total decoded
  artifact bytes, max file count, bounded tree traversal, and permitted textual extensions.
  Repositories are **never cloned**, **never built**, and **no repository code is ever executed**.
  No shell command is derived from repository content.
- **Untrusted content is never HTML.** Repository-derived content is rendered as escaped text
  (React), never as raw HTML. Artifact paths are validated against traversal and URL schemes.
- **Server-side secrets.** GitHub tokens, OAuth secrets, and LLM keys are server-side only and are
  never exposed to the browser. Secrets are not logged.
- **Sessions & CSRF.** Sessions are HMAC-signed, `httpOnly`, `SameSite=Lax`, and `Secure` in
  production. OAuth uses a state parameter. Cookie-authenticated JSON mutations require the exact
  configured `Origin`, reject cross-site Fetch Metadata, and require `application/json`; server-to-
  server signed inboxes use their own replay and signature boundary.
- **Authorization.** Editorial actions require the EDITOR/ADMIN role, checked server-side on every
  route. Editorially meaningful changes are written to an append-only audit log.
- **Input limits.** JSON bodies are size-limited; submission, discussion, and formal challenge
  mutation endpoints are route-scoped rate limited; all inputs are validated with Zod.
- **Grounding.** LLM discussion output is validated against a schema and rejected if it references
  identifiers not present in the evidence packet.

The current evidence checklist and bounded residual risks are recorded in
[`docs/security-audit-2026-07.md`](docs/security-audit-2026-07.md).

## Non-production notes

- The development-only mock sign-in is **refused in production** and only active when
  `AUTH_MOCK=1` outside production. An attempted mock login in a locked-down environment is
  audited.
- SQLite is for local development only; use PostgreSQL in production.
