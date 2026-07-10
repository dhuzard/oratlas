import { type Metadata } from "next";
import { Card, Notice } from "@oratlas/ui";
import { getServerEnv } from "@oratlas/config";
import { getCurrentUser } from "@/lib/auth";
import { mockSignInAction, signOutAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const env = getServerEnv();
  const user = await getCurrentUser();

  return (
    <div className="prose">
      <h1>Sign in</h1>
      <p className="muted">
        Anyone can browse accepted reviews. Signing in is required only to submit a repository. Only
        minimal GitHub identity is stored (id, login, avatar, profile URL).
      </p>

      {error ? (
        <Notice tone="error" title="Sign-in error">
          {error}
        </Notice>
      ) : null}

      {user ? (
        <Card title={`Signed in as ${user.githubLogin}`}>
          <p>Role: {user.role}</p>
          <form action={signOutAction}>
            <button className="btn btn-secondary" type="submit">
              Sign out
            </button>
          </form>
        </Card>
      ) : env.githubOauthEnabled ? (
        <Card title="GitHub">
          <p>
            <a className="btn" href="/api/auth/github/start">
              Continue with GitHub
            </a>
          </p>
        </Card>
      ) : env.mockAuthEnabled ? (
        <Card title="Development sign-in">
          <Notice tone="warning" title="Development-only mock authentication">
            GitHub OAuth is not configured. This clearly-marked mock sign-in is available only
            because <span className="mono">AUTH_MOCK=1</span> and this is not production. It is
            refused in production.
          </Notice>
          <form action={mockSignInAction} className="btn-row">
            <button className="btn" name="role" value="USER" type="submit">
              Sign in as submitter
            </button>
            <button className="btn btn-secondary" name="role" value="EDITOR" type="submit">
              Sign in as editor
            </button>
          </form>
        </Card>
      ) : (
        <Notice tone="error" title="Authentication unavailable">
          Neither GitHub OAuth nor development mock authentication is configured. Set
          <span className="mono"> GITHUB_CLIENT_ID</span>/
          <span className="mono">GITHUB_CLIENT_SECRET</span> for OAuth, or{" "}
          <span className="mono">AUTH_MOCK=1</span> in development.
        </Notice>
      )}
    </div>
  );
}
