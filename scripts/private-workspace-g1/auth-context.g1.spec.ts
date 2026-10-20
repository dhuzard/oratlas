import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { G1_BASE_URL, G1_FIXED_CLOCK } from "./capture.js";
import { assertPublicChildEnv } from "./child-env.js";
import { activeNextStores, nextInternals, runInRouteContext } from "./next-request-context.js";
import {
  cookieHeader,
  FIXTURE_USERS,
  fixtureUser,
  G1_SESSION_COOKIE,
  G1_SESSION_ISSUED_AT,
  G1_SESSION_SECRET,
  NEGATIVE_SESSIONS,
  NO_SESSION,
  validSession,
  type PrincipalLabel,
  type SessionRecipe,
  type SessionSigner,
} from "./principals.js";

// Auth evidence, separate from the cookie-neutral captures: production `getCurrentUser`,
// `requireUser`/`requireEditor`/`requireAdmin`, `createSessionToken`/`readSessionToken` and the
// real Prisma `User` lookup run unmodified inside real Next request contexts over the restricted
// public connection. Nothing in next/headers, the auth module, the token functions or Prisma is
// mocked; Date (only) is fixed so the fixed-issue tokens are inside their lifetime.

type SessionUser = { id: string; githubLogin: string; role: string } & Record<string, unknown>;
type Auth = {
  getCurrentUser(): Promise<SessionUser | null>;
  requireUser(): Promise<SessionUser>;
  requireEditor(): Promise<SessionUser>;
  requireAdmin(): Promise<SessionUser>;
  AuthError: new (...args: never[]) => Error & { status: number };
};

let out: string;
let auth: Auth;
let sign: SessionSigner;
let read: (token: string, secret: string, nowMs?: number) => string | null;
let disconnect: () => Promise<void>;
const evidence: Record<string, unknown> = {};

beforeAll(async () => {
  out = assertPublicChildEnv(process.env, "G1_AUTH_EVIDENCE_OUT");
  nextInternals();
  vi.stubGlobal("fetch", () => {
    throw new Error("External HTTP is blocked in the G1 auth suite");
  });
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  const [authModule, token, db] = await Promise.all([
    import("@/lib/auth"),
    import("@/lib/session-token"),
    import("@/lib/db"),
  ]);
  auth = authModule as unknown as Auth;
  sign = token.createSessionToken;
  read = token.readSessionToken;
  disconnect = () => db.prisma.$disconnect();
});

afterAll(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  }
  await disconnect?.();
});

function inSession<T>(recipe: SessionRecipe, callback: () => Promise<T>): Promise<T> {
  const cookie = cookieHeader(recipe, sign);
  const request = new Request(`${G1_BASE_URL}/api/g1-auth-probe`, {
    headers: cookie === undefined ? {} : { cookie },
  });
  return runInRouteContext(request, "/api/g1-auth-probe/route", callback).then(
    ({ result }) => result,
  );
}

function recipeFor(label: PrincipalLabel): SessionRecipe {
  return label === "anonymous" ? NO_SESSION : validSession(label);
}

async function outcome(call: () => Promise<SessionUser>): Promise<string> {
  try {
    const user = await call();
    return `ok:${user.id}:${user.role}`;
  } catch (error) {
    if (error instanceof auth.AuthError) return `AuthError:${error.status}:${error.message}`;
    throw error;
  }
}

const tick = () => new Promise((resolvePromise) => setImmediate(resolvePromise));

describe("G1 auth evidence: production session functions in a real Next request context", () => {
  it("issues every valid fixture token with the production signer and reads it back", () => {
    const tokens = FIXTURE_USERS.map((user) => {
      const token = sign(user.id, G1_SESSION_SECRET, Date.parse(G1_SESSION_ISSUED_AT));
      expect(cookieHeader(validSession(user.label), sign)).toBe(`${G1_SESSION_COOKIE}=${token}`);
      expect(read(token, G1_SESSION_SECRET)).toBe(user.id);
      return { label: user.label, userId: user.id, readBack: read(token, G1_SESSION_SECRET) };
    });
    evidence.tokens = tokens;
  });

  it("resolves exactly each principal's user and role projection (anonymous: none)", async () => {
    const resolved: Record<string, unknown> = {};
    resolved.anonymous = await inSession(NO_SESSION, () => auth.getCurrentUser());
    expect(resolved.anonymous).toBeNull();
    for (const user of FIXTURE_USERS) {
      const current = await inSession(validSession(user.label), () => auth.getCurrentUser());
      expect(current).toEqual({
        id: user.id,
        githubLogin: user.githubLogin,
        displayName: user.displayName,
        avatarUrl: null,
        profileUrl: null,
        role: user.role,
      });
      resolved[user.label] = current;
    }
    evidence.getCurrentUser = resolved;
  });

  it("enforces requireUser/requireEditor/requireAdmin for all six principals", async () => {
    const denied = (status: number, message: string) => `AuthError:${status}:${message}`;
    const ok = (label: Exclude<PrincipalLabel, "anonymous">) =>
      `ok:${fixtureUser(label).id}:${fixtureUser(label).role}`;
    const expected: Record<PrincipalLabel, [string, string, string]> = {
      anonymous: [
        denied(401, "Sign in required."),
        denied(401, "Sign in required."),
        denied(401, "Sign in required."),
      ],
      "A-only": [
        ok("A-only"),
        denied(403, "Editor role required."),
        denied(403, "Administrator role required."),
      ],
      "B-only": [
        ok("B-only"),
        denied(403, "Editor role required."),
        denied(403, "Administrator role required."),
      ],
      "A+B": [
        ok("A+B"),
        denied(403, "Editor role required."),
        denied(403, "Administrator role required."),
      ],
      EDITOR: [ok("EDITOR"), ok("EDITOR"), denied(403, "Administrator role required.")],
      ADMIN: [ok("ADMIN"), ok("ADMIN"), ok("ADMIN")],
    };
    const actual: Record<string, string[]> = {};
    for (const label of Object.keys(expected) as PrincipalLabel[]) {
      actual[label] = await inSession(recipeFor(label), async () => [
        await outcome(() => auth.requireUser()),
        await outcome(() => auth.requireEditor()),
        await outcome(() => auth.requireAdmin()),
      ]);
    }
    evidence.requireMatrix = actual;
    expect(actual).toEqual(expected);
  });

  it("resolves malformed, signed-expired, tampered and signed-missing-user sessions to no user", async () => {
    const results: Array<Record<string, unknown>> = [];
    for (const recipe of NEGATIVE_SESSIONS) {
      const cookie = cookieHeader(recipe, sign)!;
      const token = cookie.slice(G1_SESSION_COOKIE.length + 1);
      const result = {
        case: recipe.case,
        readSessionToken: read(token, G1_SESSION_SECRET),
        getCurrentUser: await inSession(recipe, () => auth.getCurrentUser()),
        requireUser: await inSession(recipe, () => outcome(() => auth.requireUser())),
      };
      results.push(result);
      expect(result.getCurrentUser, recipe.case).toBeNull();
      expect(result.requireUser, recipe.case).toBe("AuthError:401:Sign in required.");
      // Only the signed token for a missing user passes the signature/lifetime check; it fails at
      // the database lookup, which proves the User query (not the token) rejected it.
      expect(result.readSessionToken, recipe.case).toBe(
        recipe.case === "signed-missing-user" ? recipe.userId : null,
      );
    }
    evidence.negativeSessions = results;
  });

  it("keeps alternating and overlapping A/B contexts isolated with no cookie bleed", async () => {
    const observe = (label: PrincipalLabel) =>
      inSession(recipeFor(label), async () => {
        const seen: Array<string | null> = [];
        for (let step = 0; step < 3; step += 1) {
          seen.push((await auth.getCurrentUser())?.id ?? null);
          await tick();
        }
        return seen;
      });
    const order: PrincipalLabel[] = ["A-only", "B-only", "A+B", "anonymous", "B-only", "A-only"];
    const overlapping = await Promise.all(order.map((label) => observe(label)));
    const expectedId = (label: PrincipalLabel) =>
      label === "anonymous" ? null : fixtureUser(label).id;
    expect(overlapping).toEqual(order.map((label) => Array(3).fill(expectedId(label))));
    const alternating: Array<Array<string | null>> = [];
    for (const label of ["A-only", "B-only", "A-only", "B-only"] as const) {
      alternating.push(await observe(label));
    }
    expect(alternating).toEqual(
      ["A-only", "B-only", "A-only", "B-only"].map((label) =>
        Array(3).fill(expectedId(label as PrincipalLabel)),
      ),
    );
    evidence.contextIsolation = { overlapping: { order, observed: overlapping }, alternating };
  });

  it("leaves no request context after completion and refuses ambient sessions outside one", async () => {
    expect(activeNextStores()).toEqual({ work: false, workUnit: false });
    await expect(auth.getCurrentUser()).rejects.toThrow(/outside a request scope/u);
    evidence.afterCompletion = { activeStores: activeNextStores(), outsideScope: "rejected" };
  });
});
