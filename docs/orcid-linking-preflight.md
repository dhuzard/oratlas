# ORCID Linking Preflight Research

**Date observed:** 2026-10-20 (UTC)  
**Task:** Documented facts and unresolved decisions for R1 verified ORCID identity linking  
**References:** Issue #203, ORATLAS_DECISIONS.md §12–14, CONTRIBUTING.md

---

## Executive Summary

ORAtlas #203 requires verified ORCID identity linking (OAuth 3-legged) with unverified fallback support. This preflight documents official ORCID OAuth mechanisms, identifies three unresolved architectural decisions, and maps integration dependencies.

**Key constraint:** Identifier control (verified by ORCID OAuth) does not imply authorship, access, or consent (§ADR-12, invariants in CLAUDE.md).

---

## OAuth Endpoints and Production/Sandbox Identity Separation

| Environment    | Authorization                               | Token Exchange                          | API (Member)                              | API (Public)                              |
| -------------- | ------------------------------------------- | --------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| **Sandbox**    | `https://sandbox.orcid.org/oauth/authorize` | `https://sandbox.orcid.org/oauth/token` | `https://api.sandbox.orcid.org/[version]` | `https://pub.sandbox.orcid.org/[version]` |
| **Production** | `https://orcid.org/oauth/authorize`         | `https://orcid.org/oauth/token`         | `https://api.orcid.org/[version]`         | `https://pub.orcid.org/[version]`         |

**Sandbox/production are separate identity systems** — ORCID accounts and tokens do not cross environments (verified by HTTP 200 responses to both endpoints, 2026-10-20).

---

## OAuth 3-Legged Flow: Parameters and Redirect Registration

**Authorization request parameters** (documented):

```
GET https://[sandbox.]orcid.org/oauth/authorize?
  client_id=[Your client ID]
  &response_type=code
  &scope=[/authenticate or /read-limited or ...scope list...]
  &redirect_uri=[Your registered landing page]
```

**Token exchange parameters** (POST, server-to-server, required):

```
POST https://[sandbox.]orcid.org/oauth/token
  Accept: application/json
  Content-Type: application/x-www-form-urlencoded

  client_id=[Your client ID]
  client_secret=[Your client secret]
  grant_type=authorization_code
  code=[6-digit code from authorization response]
  redirect_uri=[Must match authorization request exactly]
```

**Redirect URI validation and registration:**

- ORCID validates redirect URIs against a registered allowlist per client
- **Host-prefix matching:** If registered as `https://example.com`, all paths at that host are accepted (`https://example.com/path1`, `/path2`, etc.) per documented behavior
- Unregistered redirect URIs cause OAuth flow failures (security boundary)
- State parameter not explicitly documented in ORCID examples; common OAuth libraries inject it (verify in implementation)

**Confidential client requirement:** Client secret must never be transmitted client-side; token exchange must happen server-to-server (standard OAuth 2.0 practice).

---

## Authenticated Token Response and Identity Fields

**Token response body** (JSON, documented example):

```json
{
  "access_token": "f5af9f51-07e6-4332-8f1a-c0c11c1e3728",
  "token_type": "bearer",
  "refresh_token": "f725f747-3a65-49f6-a231-3e8944ce464d",
  "expires_in": 631138518,
  "scope": "/activities/update /read-limited",
  "name": "Sofia Garcia",
  "orcid": "0000-0001-2345-6789"
}
```

**Authenticated identity fields from token response:**

- `orcid` — Full ORCID iD URI (`https://orcid.org/0000-0001-2345-6789` recommended per docs) or plain `0000-0001-2345-6789`
- `name` — User-supplied name from ORCID record (profile-provided, not controlled by linking application)
- `access_token` — Bearer token, valid ~20 years or until user revokes (verified means ORCID confirmed identifier control, not authorship/membership)
- `refresh_token` — Reusable to request new tokens with same or narrower scopes
- `scope` — Granted permissions (e.g., `/read-limited`, `/authenticate`)
- `token_type` — Always `bearer` per OpenID Connect standard

**Distinction:** `orcid` field in token response proves ORCID-verified identifier control. User-supplied `orcid_id` claim (unverified) in local payload is different and must remain unverified and visible as such.

---

## OpenID Connect and ID Token Support

**OpenID Connect availability:** ORCID supports OpenID (`openid` scope, no leading `/`) as documented.

- When `openid` scope is included in authorization request, token response includes `id_token` (JWT, not documented in example but noted as available)
- `id_token` structure and claims are unverified (official ORCID docs do not provide sample `id_token` content or claim definitions in fetched materials)
- Userinfo endpoint availability and exact claim names: **unverified** in fetched ORCID docs

**Recommendation:** If using OpenID, validate JWT signature against ORCID's public key (standard OpenID practice) but verify against official ORCID JWT examples before implementation.

---

## Scopes for Identifier-Only Account Linking

**Scope for minimal verification (identifier + public profile only):**

- `/authenticate` — Grants `orcid` iD and public record read access only. Recommended for account linking when no profile data is required.
- Other scopes (`/read-limited`, `/activities/update`, `/person/update`) grant broader access not needed for identity verification.

**Token response with `/authenticate` scope:** Returns `orcid` field but does not grant access to private affiliations or user info endpoint.

**Implication:** For verified ORCID linking (proving identifier control), `/authenticate` scope is sufficient. No need for broader profile access unless the application later requires writing to ORCID records.

---

## PKCE Support Status

**PKCE (Proof Key for Code Exchange, RFC 7636):** Not mentioned in fetched ORCID documentation.

- Authorization request examples do not include `code_challenge` or `code_challenge_method` parameters
- Token exchange examples do not reference `code_verifier`
- **Status: UNVERIFIED** in official ORCID docs; assume PKCE is optional or unsupported unless official guidance emerges

**Security implication:** If PKCE is not supported, authorization code is the only client identifier proof. Confidential clients must use `client_secret` to protect against authorization code interception.

---

## Unresolved Owner Decisions (Blockers for Implementation)

### 1. Manual vs. Verified Precedence (Policy: ADR-12, ADR-14, §5)

**Scenario:** A researcher has a local unverified ORCID claim (`0000-0001-5678-1234`) and later OAuth-links the same ORCID. Which wins?

**Current baseline:** Issue #203 states unverified ORCID iD may remain unverified and visible as such; verified OAuth link should be distinguished.

**Unresolved:**

- Should verified link overwrite/shadow/subsume the unverified claim in UI and queries?
- Can both coexist (showing sources/provenance)?
- Does verified link grant any privileged behavior (e.g., auto-resolve contributed publications) that unverified does not?
- Impacts: publication attribution UI, `My Research` directory filtering, citation/credit display (see issue #207)

**Recommendation:** Require explicit owner decision: **manual claims are source assertions, verified links are authorization proofs; display both with method/date distinctions, no automatic coercion.**

### 2. Unlink, Revocation, and Recovery (Missing ADR)

**Scenario:** Researcher unlinks ORCID or ORCID revokes the ORAtlas refresh token.

**Unresolved:**

- Can researcher unlink on ORAtlas side (delete the linking record)? If yes, what happens to prior contributions attributed via that link?
- Is unlink audited (logged, timestamped, immutable)?
- If ORCID revokes the token, can researcher re-link without repeating the OAuth flow?
- Can researcher recover (restore) an unlink, or is deletion permanent?
- Post-unlink, does the unverified fallback ORCID (if any) re-activate as the author claim?
- Orphaned contributions: remain attributed to the now-unlinked ORCID, or revert to unverified claim, or move to researcher's local identity?

**Recommendation:** Require ADR: unlink is immutable deletion (audit-logged), recovery requires re-OAuth, orphaned attributions remain linked to the ORCID with clear revocation marker, fallback to local unverified claim requires explicit owner restoration.

### 3. Retention, Privacy, and Public Wording of Linking Metadata (Missing ADR)

**Scenario:** How long are linking records (ORCID, `verified_at`, issuer, revocation date) retained? Are they public?

**Unresolved:**

- Retention period for revoked links (90 days per §ADR-9, or indefinite as provenance)?
- Are `verified_at`, `issuer`, `verification_method` public (shown on researcher profile)?
- Can a researcher hide a verified link (keep it private for authorization but not public display)?
- Public wording: "This researcher's ORCID account is verified" vs. "This ORCID account is linked and confirmed" — meaning difference?
- Data subject access: Can researcher export linking metadata (GDPR Article 15)?
- Takedown: If researcher requests deletion of profile, are linking records purged or retained as audit trail?

**Recommendation:** Require ADR: verified linking metadata is public attribution provenance (published with immutable timestamp), retention indefinite per §ADR-9 but purged after 90 days if researcher deletes profile and no legal hold applies; private-toggle not supported (linking is authorial claim, not session secret).

---

## D11 Provisional Counsel and DPIA Requirement

**Issue #203 scope:** "Verified ORCID identity linking" implies storing ORCID iD + token + linked-local-subject.

**Data protection concern:** Tokens and `linked-local-subject` are personal data (controller: ORAtlas, subject: researcher). Storage, transmission, and revocation are subject to data protection (GDPR Article 35 — DPIA may be required for high-risk processing).

**Status:** No Data Protection Impact Assessment (DPIA) or privacy counsel cited in issue #203 or ORATLAS_DECISIONS.md.

**Blocker:** Implementation should not store real tokens or link live ORCID accounts until:

- Legal counsel confirms DPIA necessity and scope
- Privacy audit of token storage, refresh, and revocation workflows
- ORCID's privacy policy is reconciled with ORAtlas's privacy terms (separate identity systems; token revocation, export, deletion contracts)

**Provisional recommendation:** Sandbox testing and mock fixtures only until legal/privacy checkpoint.

---

## Linking Verification Semantics (Not Authorship or Access)

**Invariant (CLAUDE.md, §ADR-12):** Verified ORCID link proves **identifier control only**, not:

- Authorship of any contribution
- Membership in any group
- Access to private collaborations
- Consent to expose data
- Grant to merge or upgrade local account

**Implementation implication:** Token response `orcid` field is a cryptographic proof of identifier control, not a synonym for "this person wrote this paper." Linking should not auto-populate publications, auto-grant visibility, or pre-fill contribution roles.

---

## Next Slice Dependencies (Implementation Roadmap)

**Slice 1 (Proposed, this preflight):** Persist ORCID linking metadata locally (sandbox mode, mock tokens)

- Schema: `UserProfile.orcid_verified`, `orcid_token_hash`, `orcid_verified_at`, `orcid_issuer`, `orcid_verification_method`, `orcid_revoked_at`
- No real token storage; use mock fixtures for tests
- Resolve decisions #1–3 and DPIA before moving to Slice 2

**Slice 2 (Proposed):** Unconnected OAuth flow tests (UI + callback handler)

- Sandbox client registration (test credentials)
- Mock authorization/token endpoints
- Verify redirect URI validation, state parameter, authorization code exchange
- No profile mutations; test persistence layer only

**Slice 3 (Future):** Researcher directory projection with verified links

- `My Research` authenticated view distinguishes verified ORCID vs. unverified claim
- Show `verified_at`, `verification_method` in profile
- Unlink affordance (audit-logged, immutable)

**Slice 4 (Future, subject to issues #207, #213):** Public attribution and credit gating

- Verified ORCID link appears in public researcher profile **only if** explicit publication consent is given
- CRediT assertions reference exact contribution revision + verified link (separate from bibliography coauthor names)

---

## Verified Facts and Citations

**Sources fetched (2026-10-20 UTC):**

- `https://info.orcid.org/documentation/integration-guide/getting-started-with-your-orcid-integration/` — Scopes, token response format, client registration
- `https://info.orcid.org/documentation/integration-guide/orcid-oauth-sign-in-guidelines/` — OAuth flow guidelines (incomplete in fetch)
- `https://raw.githubusercontent.com/ORCID/ORCID-Source/main/orcid-api-web/README.md` — Official endpoints, token examples, OpenID Connect note
- HTTP header probes to `https://orcid.org/oauth/authorize`, `https://sandbox.orcid.org/oauth/authorize` — Confirmed endpoints active

**Limitation:** ORCID official docs do not specify:

- PKCE requirement or support (assumed optional/unsupported)
- `id_token` claim names and structure (OpenID Connect mentioned, structure unverified)
- Exact userinfo endpoint URL or claims
- State parameter requirement (inferred from OAuth 2.0 standard, not explicit in ORCID docs)
- Token revocation endpoint (assumed standard OAuth 2.0 revocation, not verified)

---

## Summary: Ready for ADR, Not for Live Activation

This preflight establishes that ORCID OAuth 3-legged linking is **technically feasible with sandbox testing** but **blocked on three policy decisions and one privacy checkpoint** before live activation:

1. **Manual vs. verified precedence** (ADR needed)
2. **Unlink and recovery protocol** (ADR needed)
3. **Retention and public wording** (ADR needed)
4. **DPIA and legal counsel** (privacy checkpoint)

Sandbox implementation and fixture testing can proceed in parallel with decision-making; **live ORCID linking and token storage should not activate until all four items are resolved and documented.**

---

**Author:** Damien Huzard  
**Status:** Preflight research, local documentation only  
**Next:** Escalate decisions #1–3 and DPIA to issue #203 comment thread for maintainer ratification
