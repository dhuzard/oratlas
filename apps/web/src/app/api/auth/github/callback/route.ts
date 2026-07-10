import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getServerEnv } from "@oratlas/config";
import { createSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GitHub OAuth callback: exchange code, store minimal identity, open session. */
export async function GET(request: Request) {
  const env = getServerEnv();
  if (!env.githubOauthEnabled)
    return errorResponse("bad-request", "GitHub OAuth is not configured.");

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = await cookies();
  const expectedState = jar.get("oratlas_oauth_state")?.value;
  jar.delete("oratlas_oauth_state");

  if (!code || !state || !expectedState || state !== expectedState) {
    return errorResponse("bad-request", "Invalid OAuth state.");
  }

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.NEXT_PUBLIC_BASE_URL}/api/auth/github/callback`,
    }),
  });
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token)
    return errorResponse("upstream-error", "OAuth token exchange failed.");

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "open-review-atlas",
    },
  });
  if (!userRes.ok) return errorResponse("upstream-error", "Could not read GitHub profile.");
  const gh = (await userRes.json()) as {
    id: number;
    login: string;
    name?: string;
    avatar_url?: string;
    html_url?: string;
  };

  // Store ONLY minimal identity (spec §5).
  const user = await prisma.user.upsert({
    where: { githubLogin: gh.login },
    update: {
      githubUserId: String(gh.id),
      displayName: gh.name ?? gh.login,
      avatarUrl: gh.avatar_url,
      profileUrl: gh.html_url,
    },
    create: {
      githubUserId: String(gh.id),
      githubLogin: gh.login,
      displayName: gh.name ?? gh.login,
      avatarUrl: gh.avatar_url,
      profileUrl: gh.html_url,
      role: "USER",
    },
  });
  await createSession(user.id);
  await audit(user.id, "auth.github-login", "auth", user.id, {});

  return NextResponse.redirect(`${env.NEXT_PUBLIC_BASE_URL}/submit`);
}
