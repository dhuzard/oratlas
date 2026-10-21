import { createHash } from "node:crypto";

/**
 * Deterministic, nonproduction session fixtures for the G1 harness. Five synthetic public `User`
 * rows (seeded by fixtures/public-fixtures.sql) stand for the A-only, B-only, A+B, EDITOR and
 * ADMIN principal cases; anonymous carries no cookie. At G1, A and B are labels only: no workspace
 * or membership exists, so these principals prove public-route behaviour under real sessions, not
 * private authorization.
 *
 * Tokens are never stored: a capture records the session *recipe* plus the SHA-256 of the Cookie
 * header actually dispatched, and the spec re-derives the cookie from the recipe with the
 * production `createSessionToken` (injected, because scripts may not import application modules).
 */

export const PRINCIPAL_LABELS = [
  "anonymous",
  "A-only",
  "B-only",
  "A+B",
  "EDITOR",
  "ADMIN",
] as const;
export type PrincipalLabel = (typeof PRINCIPAL_LABELS)[number];
export type UserPrincipalLabel = Exclude<PrincipalLabel, "anonymous">;

/** Production cookie name (apps/web/src/lib/auth.ts); a drift fails every positive auth check. */
export const G1_SESSION_COOKIE = "oratlas_session";
/** Fixed non-secret session signing value for the disposable capture process only. */
export const G1_SESSION_SECRET = "g1-capture-only-not-a-secret";
/** Fixed issue time of every valid fixture token (one day before the G1 clock). */
export const G1_SESSION_ISSUED_AT = "2026-03-31T00:00:00.000Z";
/** Issue time of the signed-but-expired token (beyond the seven-day session lifetime). */
export const G1_EXPIRED_SESSION_ISSUED_AT = "2026-03-01T00:00:00.000Z";
/** Signed token for a user id that has no row. */
export const G1_MISSING_USER_ID = "g1-user-deleted";
export const G1_MALFORMED_SESSION = "g1-malformed-session-value";

export type FixtureUser = {
  readonly label: UserPrincipalLabel;
  readonly id: string;
  readonly githubUserId: string;
  readonly githubLogin: string;
  readonly displayName: string;
  readonly role: "USER" | "EDITOR" | "ADMIN";
  /** G1 labels only; no membership rows exist. */
  readonly workspaceLabels: readonly ("A" | "B")[];
};

export const FIXTURE_USERS: readonly FixtureUser[] = [
  {
    label: "A-only",
    id: "g1-user-a-only",
    githubUserId: "g1-synthetic-github-0001",
    githubLogin: "g1-fixture-a-only",
    displayName: "G1 Fixture A-only",
    role: "USER",
    workspaceLabels: ["A"],
  },
  {
    label: "B-only",
    id: "g1-user-b-only",
    githubUserId: "g1-synthetic-github-0002",
    githubLogin: "g1-fixture-b-only",
    displayName: "G1 Fixture B-only",
    role: "USER",
    workspaceLabels: ["B"],
  },
  {
    label: "A+B",
    id: "g1-user-a-and-b",
    githubUserId: "g1-synthetic-github-0003",
    githubLogin: "g1-fixture-a-and-b",
    displayName: "G1 Fixture A+B",
    role: "USER",
    workspaceLabels: ["A", "B"],
  },
  {
    label: "EDITOR",
    id: "g1-user-editor",
    githubUserId: "g1-synthetic-github-0004",
    githubLogin: "g1-fixture-editor",
    displayName: "G1 Fixture Editor",
    role: "EDITOR",
    workspaceLabels: [],
  },
  {
    label: "ADMIN",
    id: "g1-user-admin",
    githubUserId: "g1-synthetic-github-0005",
    githubLogin: "g1-fixture-admin",
    displayName: "G1 Fixture Admin",
    role: "ADMIN",
    workspaceLabels: [],
  },
];

export function fixtureUser(label: UserPrincipalLabel): FixtureUser {
  const user = FIXTURE_USERS.find((candidate) => candidate.label === label);
  if (!user) throw new Error(`No fixture user for ${label}`);
  return user;
}

export const SESSION_CASES = [
  "none",
  "valid",
  "malformed",
  "signed-expired",
  "tampered",
  "signed-missing-user",
] as const;
export type SessionCase = (typeof SESSION_CASES)[number];

export type SessionRecipe =
  | { readonly case: "none" }
  | { readonly case: "malformed"; readonly value: string }
  | {
      readonly case: "valid" | "signed-expired" | "signed-missing-user";
      readonly userId: string;
      readonly issuedAt: string;
    }
  | {
      readonly case: "tampered";
      /** The token is signed for `userId`; its payload user id is then replaced. */
      readonly userId: string;
      readonly issuedAt: string;
      readonly substitutedUserId: string;
    };

export const NO_SESSION: SessionRecipe = { case: "none" };

export function validSession(label: UserPrincipalLabel): SessionRecipe {
  return { case: "valid", userId: fixtureUser(label).id, issuedAt: G1_SESSION_ISSUED_AT };
}

/** The four reviewed invalid-session cases; each must resolve to no user. */
export const NEGATIVE_SESSIONS: readonly SessionRecipe[] = [
  { case: "malformed", value: G1_MALFORMED_SESSION },
  {
    case: "signed-expired",
    userId: fixtureUser("A-only").id,
    issuedAt: G1_EXPIRED_SESSION_ISSUED_AT,
  },
  {
    case: "tampered",
    userId: fixtureUser("A-only").id,
    issuedAt: G1_SESSION_ISSUED_AT,
    substitutedUserId: fixtureUser("ADMIN").id,
  },
  { case: "signed-missing-user", userId: G1_MISSING_USER_ID, issuedAt: G1_SESSION_ISSUED_AT },
];

/** Production token signer signature (apps/web/src/lib/session-token.ts `createSessionToken`). */
export type SessionSigner = (userId: string, secret: string, issuedAtMs: number) => string;

/** The exact cookie value a recipe dispatches, or `undefined` for no cookie. */
export function sessionCookieValue(recipe: SessionRecipe, sign: SessionSigner): string | undefined {
  switch (recipe.case) {
    case "none":
      return undefined;
    case "malformed":
      return recipe.value;
    case "valid":
    case "signed-expired":
    case "signed-missing-user":
      return sign(recipe.userId, G1_SESSION_SECRET, Date.parse(recipe.issuedAt));
    case "tampered": {
      const token = sign(recipe.userId, G1_SESSION_SECRET, Date.parse(recipe.issuedAt));
      if (!token.startsWith(`${recipe.userId}.`)) throw new Error("Unexpected token layout");
      return `${recipe.substitutedUserId}${token.slice(recipe.userId.length)}`;
    }
  }
}

export function cookieHeader(recipe: SessionRecipe, sign: SessionSigner): string | undefined {
  const value = sessionCookieValue(recipe, sign);
  return value === undefined ? undefined : `${G1_SESSION_COOKIE}=${value}`;
}

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Structural consistency of a principal/session pairing, independent of any signer: a user
 * principal must carry a valid session for exactly its own fixture user; anonymous must carry no
 * valid session. Returns problems (empty when consistent). Used by the capture validator so a
 * swapped, dropped or duplicated identity cannot pass as evidence.
 */
export function principalSessionProblems(
  principal: PrincipalLabel,
  sessionCase: SessionCase,
  session: SessionRecipe,
): string[] {
  const problems: string[] = [];
  if (session.case !== sessionCase)
    problems.push(`session recipe ${session.case} != ${sessionCase}`);
  if (principal === "anonymous") {
    if (session.case === "valid") problems.push("anonymous principal carries a valid session");
    return problems;
  }
  if (session.case !== "valid") {
    problems.push(`${principal} principal must carry a valid session, not ${session.case}`);
    return problems;
  }
  if (session.userId !== fixtureUser(principal).id) {
    problems.push(`${principal} principal dispatched the session of ${session.userId}`);
  }
  if (session.issuedAt !== G1_SESSION_ISSUED_AT) problems.push("valid session issue time drifted");
  return problems;
}
