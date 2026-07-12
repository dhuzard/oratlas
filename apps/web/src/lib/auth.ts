import "server-only";
import { cookies } from "next/headers";
import { getServerEnv } from "@oratlas/config";
import { type UserRole } from "@oratlas/contracts";
import { prisma } from "./db";
import { createSessionToken, readSessionToken, SESSION_MAX_AGE_SECONDS } from "./session-token";

const COOKIE_NAME = "oratlas_session";

export interface SessionUser {
  id: string;
  githubLogin: string;
  displayName: string | null;
  avatarUrl: string | null;
  profileUrl: string | null;
  role: UserRole;
}

/** Create a signed session cookie for a user id. */
export async function createSession(userId: string): Promise<void> {
  const env = getServerEnv();
  const token = createSessionToken(userId, env.sessionSecret);
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
}

/** Resolve the current signed-in user, or null. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const userId = readSessionToken(token, getServerEnv().sessionSecret);
  if (!userId) return null;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return null;
  return {
    id: user.id,
    githubLogin: user.githubLogin,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    profileUrl: user.profileUrl,
    role: user.role as UserRole,
  };
}

export function isEditor(user: SessionUser | null): boolean {
  return user?.role === "EDITOR" || user?.role === "ADMIN";
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Sign in required.");
  return user;
}

export async function requireEditor(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isEditor(user)) throw new AuthError("Editor role required.", 403);
  return user;
}

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status = 401,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Development-only mock login. Refused in production and only when AUTH_MOCK=1.
 * Emits an audit event either way so an attempted mock login in a locked-down
 * environment is visible.
 */
export async function mockLogin(role: UserRole = "USER"): Promise<SessionUser> {
  const env = getServerEnv();
  if (!env.mockAuthEnabled) {
    await prisma.auditEvent.create({
      data: {
        action: "auth.mock-login-refused",
        subjectType: "auth",
        subjectId: "mock",
        detailsJson: JSON.stringify({ reason: "mock auth disabled", nodeEnv: env.NODE_ENV }),
      },
    });
    throw new AuthError("Mock authentication is disabled in this environment.", 403);
  }
  const login = role === "EDITOR" ? "atlas-editor" : "atlas-submitter";
  const mockGithubUserId = `mock:${login}`;
  const user = await prisma.user.upsert({
    where: { githubUserId: mockGithubUserId },
    update: { githubLogin: login, githubLoginNormalized: login, role },
    create: {
      githubUserId: mockGithubUserId,
      githubLogin: login,
      githubLoginNormalized: login,
      displayName: `Mock ${role} (dev)`,
      role,
      profileUrl: `https://github.com/${login}`,
    },
  });
  await createSession(user.id);
  await prisma.auditEvent.create({
    data: {
      actorId: user.id,
      action: "auth.mock-login",
      subjectType: "auth",
      subjectId: user.id,
      detailsJson: JSON.stringify({ role }),
    },
  });
  return {
    id: user.id,
    githubLogin: user.githubLogin,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    profileUrl: user.profileUrl,
    role: user.role as UserRole,
  };
}

export { getServerEnv };
