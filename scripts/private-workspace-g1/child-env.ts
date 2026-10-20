import { isAbsolute } from "node:path";
import { G1_BASE_URL, G1_RATE_LIMIT } from "./capture.js";
import { G1_SESSION_SECRET } from "./principals.js";
import { G1_ENV, parseConnectionUrl, PUBLIC_ROLE_NAME } from "./target.js";

/**
 * Closed environment contract of every child that runs production handlers (capture and auth
 * evidence). The orchestrator builds exactly this environment; the child refuses anything else, so
 * no bootstrap/private credential, provider key, OAuth or mock-auth switch can leak in.
 */
export const FORBIDDEN_CHILD_ENV = [
  G1_ENV.admin,
  G1_ENV.private,
  G1_ENV.public,
  G1_ENV.ack,
  "PGPASSWORD",
  "AUTH_MOCK",
  "GITHUB_TOKEN",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "ADMIN_GITHUB_USER_IDS",
  "LLM_PROVIDER",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "ORA_CERTIFIER_API_TOKEN",
  "ORA_EVALUATOR_PROVIDER",
  "ORA_EVALUATOR_MODEL",
  "EXECUTION_PASSPORT_TRUSTED_KEYS_JSON",
] as const;

/** Environment the orchestrator passes to a public-role handler child (plus its output vars). */
export function publicChildEnv(databaseUrl: string): Record<string, string> {
  return {
    DATABASE_URL: databaseUrl,
    NEXT_PUBLIC_BASE_URL: G1_BASE_URL,
    SESSION_SECRET: G1_SESSION_SECRET,
    RATE_LIMIT_MAX: G1_RATE_LIMIT.max,
    RATE_LIMIT_WINDOW_MS: G1_RATE_LIMIT.windowMs,
  };
}

/** Validate the child environment; returns the absolute output path named by `outVariable`. */
export function assertPublicChildEnv(
  env: Readonly<Record<string, string | undefined>>,
  outVariable: string,
): string {
  const present = FORBIDDEN_CHILD_ENV.filter((name) => env[name] !== undefined);
  if (present.length > 0) throw new Error(`Child process must not receive: ${present.join(", ")}`);
  const database = parseConnectionUrl("DATABASE_URL", env.DATABASE_URL);
  if (!PUBLIC_ROLE_NAME.test(database.user)) {
    throw new Error("DATABASE_URL must authenticate as the restricted public runtime role");
  }
  if (env.NEXT_PUBLIC_BASE_URL !== G1_BASE_URL) {
    throw new Error("NEXT_PUBLIC_BASE_URL must be the deterministic G1 origin");
  }
  if (env.SESSION_SECRET !== G1_SESSION_SECRET) {
    throw new Error("SESSION_SECRET must be the fixed non-secret G1 capture value");
  }
  if (
    env.RATE_LIMIT_MAX !== G1_RATE_LIMIT.max ||
    env.RATE_LIMIT_WINDOW_MS !== G1_RATE_LIMIT.windowMs
  ) {
    throw new Error("RATE_LIMIT_MAX/RATE_LIMIT_WINDOW_MS must be the deterministic G1 budget");
  }
  const out = env[outVariable];
  if (!out || !isAbsolute(out)) throw new Error(`${outVariable} (absolute path) is required`);
  return out;
}
