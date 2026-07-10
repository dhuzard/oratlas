# Security policy

Open Review Atlas is a proof of concept, but it is built to be safe against the obvious classes of
attack given that it ingests untrusted, third-party repository content.

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the maintainers rather than opening a public
issue. Include a description, reproduction steps, and impact. We will acknowledge and respond as
soon as we reasonably can.

## Security properties (by design)

- **SSRF prevention.** Only canonical `https://github.com/{owner}/{repo}` URLs reach the network
  layer. Non-GitHub hosts, look-alike hosts, embedded credentials, `api.`/`raw.` hosts,
  localhost/loopback/link-local/private IPs, non-standard ports, and non-http(s) schemes are
  rejected before any request is made.
- **Bounded inspection.** Repositories are inspected via the GitHub API with explicit timeouts,
  max file bytes, max total bytes, max file count, bounded tree traversal, and permitted textual
  extensions. Repositories are **never cloned**, **never built**, and **no repository code is ever
  executed**. No shell command is derived from repository content.
- **Untrusted content is never HTML.** Repository-derived content is rendered as escaped text
  (React), never as raw HTML. Artifact paths are validated against traversal and URL schemes.
- **Server-side secrets.** GitHub tokens, OAuth secrets, and LLM keys are server-side only and are
  never exposed to the browser. Secrets are not logged.
- **Sessions & CSRF.** Sessions are HMAC-signed, `httpOnly`, `SameSite=Lax`, and `Secure` in
  production. OAuth uses a state parameter. Mutations use same-origin API routes / server actions
  (`form-action 'self'`).
- **Authorization.** Editorial actions require the EDITOR/ADMIN role, checked server-side on every
  route. Editorially meaningful changes are written to an append-only audit log.
- **Input limits.** JSON bodies are size-limited; submission and discussion endpoints are rate
  limited; all inputs are validated with Zod.
- **Grounding.** LLM discussion output is validated against a schema and rejected if it references
  identifiers not present in the evidence packet.

## Non-production notes

- The development-only mock sign-in is **refused in production** and only active when
  `AUTH_MOCK=1` outside production. An attempted mock login in a locked-down environment is
  audited.
- SQLite is for local development only; use PostgreSQL in production.
