import { z } from "zod";

/**
 * Server-side environment configuration. Parsed once, lazily.
 * Secrets never leave the server; nothing here is exposed with NEXT_PUBLIC_
 * except the base URL.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().default("file:./dev.db"),
  SESSION_SECRET: z.string().optional(),
  GITHUB_TOKEN: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  AUTH_MOCK: z.string().optional(),
  LLM_PROVIDER: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-sonnet-5"),
  NEXT_PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema> & {
  isProduction: boolean;
  /** Mock sign-in allowed only with explicit opt-in AND outside production. */
  mockAuthEnabled: boolean;
  githubOauthEnabled: boolean;
  llmEnabled: boolean;
  sessionSecret: string;
};

let cached: ServerEnv | undefined;

export function getServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  if (cached && env === process.env) return cached;
  const parsed = serverEnvSchema.parse(env);
  const isProduction = parsed.NODE_ENV === "production";

  if (isProduction && !parsed.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is required in production.");
  }
  const sessionSecret = parsed.SESSION_SECRET ?? "insecure-dev-session-secret";
  if (!parsed.SESSION_SECRET && !isProduction) {
    console.warn("[config] SESSION_SECRET not set — using an insecure development-only fallback.");
  }

  const githubOauthEnabled = Boolean(parsed.GITHUB_CLIENT_ID && parsed.GITHUB_CLIENT_SECRET);
  // Never silently enable mock authentication in production (spec §5).
  const mockAuthEnabled = !isProduction && parsed.AUTH_MOCK === "1";
  const llmEnabled = parsed.LLM_PROVIDER === "anthropic" && Boolean(parsed.ANTHROPIC_API_KEY);

  const result: ServerEnv = {
    ...parsed,
    isProduction,
    mockAuthEnabled,
    githubOauthEnabled,
    llmEnabled,
    sessionSecret,
  };
  if (env === process.env) cached = result;
  return result;
}

/** Test helper: clear the cached env. */
export function resetServerEnvCache(): void {
  cached = undefined;
}
