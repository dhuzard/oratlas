# ORCID Linking Preflight Research

**Date:** 2026-10-20 UTC
**Scope:** Verified ORCID identity linking via OAuth 3-legged flow (R1 requirement, issue #203)
**Status:** Technical feasibility confirmed; policy decisions and legal checkpoint required before live activation

---

## Official OAuth Endpoints

**Sandbox and production are distinct identity systems** (separate issuers per OpenID discovery):

| Environment    | Authorization                               | Token Exchange                          | Public API                                |
| -------------- | ------------------------------------------- | --------------------------------------- | ----------------------------------------- |
| **Sandbox**    | `https://sandbox.orcid.org/oauth/authorize` | `https://sandbox.orcid.org/oauth/token` | `https://pub.sandbox.orcid.org/[version]` |
| **Production** | `https://orcid.org/oauth/authorize`         | `https://orcid.org/oauth/token`         | `https://pub.orcid.org/[version]`         |

Confirmed 2026-10-20 via OpenID discovery endpoints; credentials and identities must remain environment-separated.

---

## OAuth 3-Legged Authorization Flow

**Authorization request:**

```
GET https://[sandbox.]orcid.org/oauth/authorize?
  client_id=[registered client ID]
  &response_type=code
  &scope=[/authenticate or /read-limited or other]
  &redirect_uri=[registered callback URL]
  &state=[random session-binding value - required]
```

**Token exchange (server-to-server POST):**

```
POST https://[sandbox.]orcid.org/oauth/token
  client_id=[client ID]
  client_secret=[confidential, never client-side]
  grant_type=authorization_code
  code=[authorization code from redirect]
  redirect_uri=[must match authorization request]
```

**Key facts:**

- Authorization codes are opaque (format unspecified in ORCID docs; example in readme.txt is 6 characters, not a format constraint)
- Redirect URI validation: registered allowlist enforced; ORAtlas must register exact callback URL with ORCID
- State parameter: OAuth 2.0 standard, required for session binding and CSRF protection (not explicitly documented in ORCID examples but mandatory)
- Client secret is confidential; token exchange must not expose it to the client

---

## Token Response and Identity Fields

**Example response body** (from official readme.txt):

```json
{
  "access_token": "[bearer token]",
  "token_type": "bearer",
  "refresh_token": "[reusable token]",
  "expires_in": 631138518,
  "scope": "/activities/update /read-limited",
  "name": "[user-supplied name from ORCID profile]",
  "orcid": "[ORCID iD, e.g. 0000-0001-2345-6789]"
}
```

**Semantic distinction:**

- `orcid` field: proof of identifier control (user authenticated with ORCID, not a fallback manual claim)
- `name`: user-supplied profile data (informational, not authoritative for authorship)
- `access_token`: expires ~20 years or upon user revocation
- `refresh_token`: permits new token requests without re-authorization
- **Invariant:** Verified ORCID link proves identifier control only; does not imply authorship, membership, or consent per CLAUDE.md

---

## OpenID Connect (openid scope)

**Availability:** ORCID supports `openid` scope (no leading `/`) per ORCID_AUTH_WITH_OPENID_CONNECT.md and discovery endpoints.

**ID token (JWT):** When `openid` scope is included, token response includes `id_token` field (signed, base64-encoded JWT).

**ID token claims** (documented in oidc.txt and discovery):

- `sub`: ORCID iD
- `aud`: client ID
- `iss`: issuer (`https://orcid.org` or `https://sandbox.orcid.org`)
- `iat`, `exp`: issued/expiry timestamps
- `auth_time`: user authentication time
- `nonce`: echoes nonce parameter from authorization request (if provided)
- `family_name`, `given_name`: user profile data
- `amr` (Member API only): authentication method (`"pwd"` or `"mfa"`)

**Userinfo endpoint:** Protected by `openid` scope; returns claims like `{"sub":"...", "name":"...", "family_name":"...", "given_name":"..."}`

**Validation:** Use ORCID's public key (JWKS endpoint) to verify signature, validate issuer and audience, check expiry and nonce per OpenID Core spec.

---

## Identifier-Only Scopes

**For minimal identity verification (no profile write access):**

- `/authenticate` scope: grants ORCID iD and public record read; sufficient for identity linking without broader permissions
- Other scopes (`/read-limited`, `/activities/update`) add access not required for identifier verification

---

## PKCE (Proof Key for Code Exchange)

**Status:** Not mentioned in fetched ORCID documentation. `code_challenge_methods_supported` is absent from OpenID discovery endpoints.

**Unresolved:** PKCE support is not documented in official materials. Missing field is NOT evidence of unsupport (RFC 7636 defines it as optional). **Before live adapter:** obtain official ORCID confirmation and test PKCE support; do not silently waive state or code verifier requirements.

---

## Owner Decisions (Explicitly UNDECIDED)

### 1. Manual vs. Verified Linking Precedence

**Scenario:** Researcher has unverified local ORCID claim and later OAuth-links the same ORCID iD.

**Unresolved:**

- Display both with source/method distinctions, or subsume one?
- Does verified link grant privileged behavior (e.g., auto-resolve contributed publications)?
- Impacts publication attribution UI, filtering, citation display

**Status:** Manual claims are source assertions; verified links are authorization proofs. Both must be visible with method/date metadata.

### 2. Unlink, Revocation, Recovery

**Unresolved:**

- Can researcher unlink on ORAtlas side? Permanent deletion vs. recovery?
- If token revoked by ORCID, can researcher re-link without re-OAuth?
- Post-unlink: revert to unverified claim, or orphan attributions?
- Audit trail for unlink operations

**Status:** Decision required before implementation.

### 3. Retention, Privacy, Public Display

**Unresolved:**

- How long retain linking records (verified_at, issuer, revocation_date)?
- Public metadata visibility on researcher profile?
- GDPR data subject access (export) and takedown (deletion) handling

**Status:** Decision required; note that metadata is authorial provenance, not session secret.

---

## DPIA and Legal Checkpoint

**Data protection concern:** Live ORCID linking involves storing ORCID iD, tokens, and local subject association (personal data, GDPR-scoped processing).

**Blockers before live activation:**

- Legal counsel: DPIA necessity and scope confirmation
- Privacy audit: token storage, refresh, revocation workflows
- Reconcile ORCID privacy policy with ORAtlas terms (separate identity systems; revocation/export/deletion contracts)

**Status:** Sandbox testing and mock fixtures only until legal/privacy review completes.

---

## Implementation Roadmap (Not Committed)

**Slice 1 (Proposed):** Persistence layer (sandbox mode, mock tokens)

- Unresolved: schema design deferred until decisions #1–3 and DPIA resolve

**Slice 2:** OAuth flow (unconnected mock endpoints)

- Verify redirect registration, state binding, code exchange

**Slice 3:** Researcher profile display

- Distinguish verified link from unverified claim; show verification metadata

**Slice 4:** Public attribution (post-issue #207 consent decision)

- Verified link visibility gated by explicit publication consent

---

## Verified Facts and Sources

**Fetched 2026-10-20:**

- `https://raw.githubusercontent.com/ORCID/ORCID-Source/main/orcid-api-web/README.md` — endpoints, token format, OpenID mention
- `https://raw.githubusercontent.com/ORCID/ORCID-Source/main/orcid-web/ORCID_AUTH_WITH_OPENID_CONNECT.md` — id_token examples, userinfo, discovery
- `https://orcid.org/.well-known/openid-configuration` and sandbox equivalent — issuer, endpoints, scopes_supported, auth methods
- HTTP probes to authorization endpoints — confirmed active

**Limitations:**

- PKCE support unverified; official test or docs required
- Redirect URI registration rules (host-prefix matching, exact match requirement) not confirmed in fetched docs; ORAtlas must require exact registered callback per security baseline
- Token revocation endpoint and implementation not documented; assume standard OAuth 2.0 revocation contract

---

## Next Steps

1. **Owner decisions #1–3:** Documented in issue #203 for maintainer ratification
2. **DPIA and legal counsel:** Privacy checkpoint before live activation
3. **Provider confirmation:** Official ORCID test of state binding, PKCE support, redirect validation
4. **Persistence adapter:** Schema design once policy decisions resolve
5. **Mock activation:** Separately authorized feature flag; sandbox-only until step 4 completes

**Status:** Technical preflight complete; awaiting policy and legal clearance.
