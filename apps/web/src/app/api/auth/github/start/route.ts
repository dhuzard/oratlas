import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getServerEnv } from "@oratlas/config";
import { errorResponse } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Begin GitHub OAuth (only when configured). Sets a CSRF state cookie. */
export async function GET() {
  const env = getServerEnv();
  if (!env.githubOauthEnabled) {
    return errorResponse("bad-request", "GitHub OAuth is not configured.");
  }
  const state = randomBytes(16).toString("hex");
  const jar = await cookies();
  jar.set("oratlas_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: 600,
  });
  const redirectUri = `${env.NEXT_PUBLIC_BASE_URL}/api/auth/github/callback`;
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID!);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return NextResponse.redirect(url.toString());
}
