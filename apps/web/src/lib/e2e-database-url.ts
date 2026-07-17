export interface E2EDatabaseEnvironment {
  E2E_DATABASE_URL?: string;
  DATABASE_URL?: string;
}

/**
 * A relative SQLite URL resolves against the *server's* working directory,
 * which differs between the seeding step (repo root or packages/db) and the
 * Playwright web server (apps/web). Accepting one silently splits CI seeding
 * and the app onto two databases, so only absolute file: URLs (or non-file
 * URLs) are honored.
 */
function isPortableDatabaseUrl(url: string): boolean {
  if (!url.startsWith("file:")) return true;
  const path = url.slice("file:".length);
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/** Resolve the database shared by CI seeding and the Playwright web server. */
export function resolveE2EDatabaseUrl(
  environment: E2EDatabaseEnvironment,
  fallback: string,
): string {
  for (const candidate of [environment.E2E_DATABASE_URL, environment.DATABASE_URL]) {
    if (candidate && isPortableDatabaseUrl(candidate)) return candidate;
  }
  return fallback;
}
