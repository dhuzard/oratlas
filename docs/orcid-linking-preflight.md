# ORCID account-linking preflight — #203

**Observed:** 2026-10-20 UTC. **Status:** research and synthetic foundations only; no live linking, credentials, persistence adapter or provider activation.

Verified identifier control is not authorship, scholarly verification, CRediT, membership, authorization or permission to disclose a collaboration. Existing GitHub login and the manually entered, unverified ORCID field remain unchanged.

## Sources actually checked

| Reference | Official source                                                                                                                                                                                                                          | Evidence and limit                                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1        | [ORCID API README](https://github.com/ORCID/ORCID-Source/blob/main/orcid-api-web/README.md) ([raw](https://raw.githubusercontent.com/ORCID/ORCID-Source/main/orcid-api-web/README.md))                                                   | Retrieved successfully. Documents sandbox authorization-code flow, form token exchange and an example token response. Examples are not guarantees of every field, format or lifetime.                          |
| S2        | [ORCID OpenID Connect guide](https://github.com/ORCID/ORCID-Source/blob/main/orcid-web/ORCID_AUTH_WITH_OPENID_CONNECT.md) ([raw](https://raw.githubusercontent.com/ORCID/ORCID-Source/main/orcid-web/ORCID_AUTH_WITH_OPENID_CONNECT.md)) | Retrieved successfully. Documents authorization-only scopes, signed ID tokens, nonce, discovery, JWKS and userinfo. Some examples describe historical flows; they are not an endorsement for this integration. |
| S3        | [Production discovery](https://orcid.org/.well-known/openid-configuration)                                                                                                                                                               | Retrieved successfully. Advertises issuer, authorization/token/userinfo/JWKS endpoints and `client_secret_post`.                                                                                               |
| S4        | [Sandbox discovery](https://sandbox.orcid.org/.well-known/openid-configuration)                                                                                                                                                          | Retrieved successfully. Advertises the corresponding sandbox issuer/endpoints and `client_secret_post`.                                                                                                        |

Parent attempts to retrieve the [integration guide](https://info.orcid.org/documentation/integration-guide/getting-started-with-your-orcid-integration/), [authenticated-iD tutorial](https://info.orcid.org/documentation/api-tutorials/api-tutorial-get-and-authenticated-orcid-id/) and redirect FAQ returned HTTP 403. Their current text is not relied on here. Source-branch URLs and discovery metadata can change; recheck them before implementing a live adapter and pin the reviewed source revision in that change's evidence.

## Documented provider behavior

### Endpoints and environment separation

S3 and S4 advertise:

| Environment | Issuer                      | Authorization endpoint                      | Token endpoint                          |
| ----------- | --------------------------- | ------------------------------------------- | --------------------------------------- |
| Production  | `https://orcid.org`         | `https://orcid.org/oauth/authorize`         | `https://orcid.org/oauth/token`         |
| Sandbox     | `https://sandbox.orcid.org` | `https://sandbox.orcid.org/oauth/authorize` | `https://sandbox.orcid.org/oauth/token` |

Both advertise `/oauth/userinfo` and `/oauth/jwks` under their respective issuer. Distinct issuers are directly observed; an HTTP success alone does not prove account or credential isolation. ORAtlas must keep issuer/environment namespaces and credentials separate and reject cross-environment assertions.

### Authorization code and authenticated response

S1 shows `client_id`, `response_type=code`, `scope` and `redirect_uri` on authorization, followed by a server-side, form-encoded token POST with `client_id`, `client_secret`, `grant_type=authorization_code`, `code` and `redirect_uri`. Authorization codes are opaque; do not impose a length from a sample.

S1's example token response contains `orcid` (a plain iD), `name`, `token_type`, `scope`, `expires_in`, `access_token` and `refresh_token`. Do not require every example field or assume its sample token lifetime applies universally. No token values are reproduced here.

A future adapter must derive the identifier from the authenticated provider exchange, not a callback query's claimed iD, a profile name, user-entered metadata or the roster adapter. Validate response shape, issuer/environment and ORCID format/checksum before returning a minimal identifier-control assertion. The plain OAuth response field is not itself a signed cryptographic proof.

The current shared `orcidSchema` checks identifier shape; checksum validation also exists in the source-credit contract. A future adapter must deliberately select/reuse appropriate validation rather than assuming every existing schema performs both checks. No shared schema changes are made in this batch.

### Identifier-only scopes and optional OIDC

S2 describes `/authenticate` and `openid` as equivalent authorization-only scopes and says to use one rather than both. `openid` adds an ID token and access to userinfo. Broader read/update scopes are not needed merely to establish identifier control. Do not equate `/authenticate` with permission to read protected records or write profiles.

S2 documents ID-token claims including subject, audience, issuer, issue/expiry/authentication times and a nonce when requested, plus profile/authentication-method examples. A future OIDC choice requires a complete signature, issuer, audience, algorithm, lifetime and nonce validation design against the correct issuer's JWKS; merely decoding a JWT is insufficient. OIDC is not implemented or selected by this preflight, and ORAtlas's existing HMAC session must not be replaced implicitly.

### PKCE and redirects: unresolved provider checks

Neither fetched guide establishes PKCE behavior, and S3/S4 do not advertise `code_challenge_methods_supported`. **Missing metadata is not evidence of support, non-support or optionality.** Obtain current official confirmation and controlled sandbox evidence before choosing a live flow. If provider limitations conflict with the required security design, stop for review; do not silently waive controls.

The precise current redirect registration and matching rules were not verified from accessible official registration documentation. ORAtlas's proposed security requirement is a fixed, explicitly allowlisted callback registered for the matching environment, with no caller-selected redirect destination. This is an ORAtlas requirement, not a verified statement of the provider's exact-match or host-prefix behavior.

Session-bound state, expiry, single-use consumption, current-session checks and confidential handling of client secrets remain ORAtlas requirements even where provider examples omit them. Token revocation endpoints and semantics remain **unverified**; do not assume a standard endpoint or contract.

## Owner decisions — all remain open

1. **Manual versus verified identity:** coexistence, precedence, conflicting iDs and per-user cardinality. Neither a manual claim nor a verified link grants project access. No automatic overwrite, account merge or reassignment.
2. **Unlink/recovery/invalidation:** authorization and reauthentication requirements, revocation signals, audit, relinking, session/authorization epoch changes and a finalization fence. Current sessions lack a session-instance binding and revocation registry. ADR-required invalidation cannot simply be deferred while enabling live unlink.
3. **Retention and privacy:** whether/how link history and audit are retained, erased or exported; visibility and consent. No retention duration, public-by-default metadata, controller designation or immutable-deletion policy is adopted here.
4. **Public wording and report snapshots:** describe identifier control, not a "verified researcher" or scholarly authorship. Decide how a verified link relates to `User.orcid`, `orcidVerifiedAt` and future `reviewerOrcidVerified` snapshots. Do not rewrite historical public reports.
5. **Provider and activation choice:** `/authenticate` versus fully validated OIDC, confirmed PKCE/redirect behavior, application registration, environment, privacy notice and separately authorized activation. Identifier-only linking may not need retained access/refresh tokens; decide deliberately rather than creating token storage by default.

See [ADR-0001 §§12–14](private-workspace-security-architecture.md) and the [R0 review](private-workspace-r0-review.md). D1–D11 were recorded, but D11 remains provisional and §14 remains proposed pending owner ratification. Closure of #202 or merges #216/#217 do not ratify those proposals. Counsel/DPIA confirmation of D11 is required before real private workspace data; legal/privacy requirements for live identity linking itself require an explicit owner-reviewed decision, not an invented legal conclusion in this document.

## Dependency-ready next slice

- **Now delivered:** synthetic characterization and unconnected injected-dependency foundations; see [identity-link foundations](identity-link-foundations.md). They neither exchange real codes nor establish real database/session guarantees.
- **Before persistence design:** resolve identity/cardinality/retention/public-wording decisions and confirm provider choices. Keep private-workspace gates independent.
- **Persistence/session adapter:** propose additive schema/migration separately; prove atomic flow consumption, unique identity ownership, receipt finalization and current-principal/revocation fences with real database contention and rollback tests. Resolve session-instance binding without reusing raw cookies.
- **Mock route integration:** separately authorize route/config/OpenAPI changes; test CSRF, cross-user callbacks, expiry, replay, provider failures, token non-disclosure and unlink/recovery without real accounts or secrets.
- **Live activation:** requires separate authorization, verified provider configuration, security review, privacy/legal decisions and a disabled-by-default rollout/rollback plan. No credentials, live routes or activation are part of this batch.

Private storage, invitations, membership, connectors, cross-project discovery and public credit release remain outside #203 foundations. The #198/#199 public evidence MVP is a separate workstream.
