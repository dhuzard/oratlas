export interface E2EDatabaseEnvironment {
  E2E_DATABASE_URL?: string;
  DATABASE_URL?: string;
}

/** Resolve the database shared by CI seeding and the Playwright web server. */
export function resolveE2EDatabaseUrl(
  environment: E2EDatabaseEnvironment,
  fallback: string,
): string {
  return environment.E2E_DATABASE_URL ?? environment.DATABASE_URL ?? fallback;
}
