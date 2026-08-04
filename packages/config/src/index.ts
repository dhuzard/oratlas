import { z } from "zod";
import rootPackage from "../../../package.json" with { type: "json" };

/** Version of the ORAtlas platform code that is currently running. */
export const PLATFORM_VERSION = rootPackage.version;

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
  // Colon-separated immutable GitHub numeric user IDs that may bootstrap an
  // ADMIN role at OAuth sign-in. Logins are intentionally not accepted.
  ADMIN_GITHUB_USER_IDS: z.string().optional(),
  AUTH_MOCK: z.string().optional(),
  LLM_PROVIDER: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("claude-sonnet-5"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-5"),
  NEXT_PUBLIC_BASE_URL: z.string().default("http://localhost:3000"),
  // Rate limiting (per identity+route). In-process for the POC; a shared store
  // (Redis) is the production swap. Coerced from strings so env vars parse.
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  // Offline trust policy for Execution Passport Ed25519 attestations. JSON
  // array of {keyId, algorithm, publicKeyPem, issuer, subject}; parsed and
  // fingerprint-checked by @oratlas/execution-passports.
  EXECUTION_PASSPORT_TRUSTED_KEYS_JSON: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema> & {
  isProduction: boolean;
  /** Mock sign-in allowed only with explicit opt-in AND outside production. */
  mockAuthEnabled: boolean;
  githubOauthEnabled: boolean;
  adminGithubUserIds: readonly string[];
  llmEnabled: boolean;
  sessionSecret: string;
};

let cached: ServerEnv | undefined;

export function parseAdminGithubUserIds(value?: string): readonly string[] {
  if (!value?.trim()) return [];

  const ids = value
    .split(":")
    .map((id) => id.trim())
    .filter(Boolean);
  for (const id of ids) {
    const numericId = Number(id);
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(numericId)) {
      throw new Error(
        "ADMIN_GITHUB_USER_IDS must contain colon-separated positive GitHub numeric user IDs.",
      );
    }
  }
  return [...new Set(ids)];
}

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
  const adminGithubUserIds = parseAdminGithubUserIds(parsed.ADMIN_GITHUB_USER_IDS);
  // Never silently enable mock authentication in production (spec §5).
  const mockAuthEnabled = !isProduction && parsed.AUTH_MOCK === "1";
  const llmEnabled =
    (parsed.LLM_PROVIDER === "anthropic" && Boolean(parsed.ANTHROPIC_API_KEY)) ||
    (parsed.LLM_PROVIDER === "openai" && Boolean(parsed.OPENAI_API_KEY));

  const result: ServerEnv = {
    ...parsed,
    isProduction,
    mockAuthEnabled,
    githubOauthEnabled,
    adminGithubUserIds,
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
