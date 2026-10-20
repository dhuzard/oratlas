/**
 * G1 disposable-target validation (docs/private-workspace-g1-harness.md). Pure and offline: parses
 * the three dedicated connection URLs and the explicit acknowledgement, and refuses anything that
 * is not a narrowly allowed local disposable PostgreSQL target. Error messages name variables, never
 * their values, so a refused secret is not echoed.
 */

export const G1_ENV = {
  admin: "G1_TEST_ADMIN_DATABASE_URL",
  public: "G1_TEST_PUBLIC_DATABASE_URL",
  private: "G1_TEST_PRIVATE_DATABASE_URL",
  ack: "G1_TEST_DISPOSABLE_TARGET_ACK",
} as const;

/** Only loopback servers are acceptable; no DNS names that could be re-pointed. */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
export const DATABASE_NAME = /^oratlas_g1(?:_[a-z0-9]{1,32})?$/u;
export const PUBLIC_ROLE_NAME = /^oratlas_g1_public(?:_[a-z0-9]{1,24})?$/u;
export const PRIVATE_ROLE_NAME = /^oratlas_g1_private(?:_[a-z0-9]{1,24})?$/u;
/** Lower-case unquoted-safe PostgreSQL identifier (no quoting tricks, max 63 bytes). */
export const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/u;
export const PRIVATE_SCHEMA = "private_ws";

export class G1TargetError extends Error {
  override readonly name = "G1TargetError";
}

export type G1Credential = { readonly user: string; readonly password: string };

export type G1Connection = G1Credential & {
  readonly host: string;
  readonly port: number;
  readonly database: string;
};

export type G1Target = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly admin: G1Connection;
  readonly public: G1Connection;
  readonly private: G1Connection;
};

type Env = Readonly<Record<string, string | undefined>>;

export function expectedAck(host: string, port: number, database: string): string {
  return `disposable-g1-target:${host}:${port}/${database}`;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function decode(variable: string, part: string, value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (hasControlCharacter(decoded)) throw new G1TargetError(`${variable}: ${part} is invalid`);
    return decoded;
  } catch (error) {
    if (error instanceof G1TargetError) throw error;
    throw new G1TargetError(`${variable}: ${part} is not valid percent-encoding`);
  }
}

/** Parse one dedicated URL. Throws a value-free error for anything outside the allowed shape. */
export function parseConnectionUrl(variable: string, raw: string | undefined): G1Connection {
  if (raw === undefined || raw.trim() === "") throw new G1TargetError(`${variable} is not set`);
  if (raw !== raw.trim() || hasControlCharacter(raw)) {
    throw new G1TargetError(`${variable} contains whitespace or control characters`);
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new G1TargetError(`${variable} is not a valid URL`);
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new G1TargetError(`${variable} must use the postgresql: scheme`);
  }
  if (url.hash) throw new G1TargetError(`${variable} must not contain a fragment`);
  // libpq query parameters such as host=, hostaddr=, service= or options= can silently redirect
  // or reconfigure a connection; only Prisma's schema=public is accepted.
  for (const [key, value] of url.searchParams) {
    if (!(key === "schema" && value === "public")) {
      throw new G1TargetError(`${variable} has an unsupported query parameter`);
    }
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new G1TargetError(`${variable} must target a loopback host (localhost/127.0.0.1/[::1])`);
  }
  if (!/^[0-9]{2,5}$/u.test(url.port)) {
    throw new G1TargetError(`${variable} must state an explicit port`);
  }
  const port = Number(url.port);
  if (port < 1024 || port > 65535)
    throw new G1TargetError(`${variable} port is outside 1024-65535`);
  const segments = url.pathname.split("/");
  if (segments.length !== 2 || segments[1] === "") {
    throw new G1TargetError(`${variable} must name exactly one database`);
  }
  const database = decode(variable, "database", segments[1]!);
  if (!DATABASE_NAME.test(database)) {
    throw new G1TargetError(`${variable} database name is not an allowed disposable G1 name`);
  }
  const user = decode(variable, "user", url.username);
  if (!SAFE_IDENTIFIER.test(user)) {
    throw new G1TargetError(`${variable} user must be a lower-case PostgreSQL identifier`);
  }
  const password = decode(variable, "password", url.password);
  if (password.length > 200) throw new G1TargetError(`${variable} password is too long`);
  return { host: url.hostname, port, database, user, password };
}

/**
 * Validate the complete disposable target. All three URLs must name the same loopback server and
 * database with distinct users matching the expected role names, and the acknowledgement must
 * repeat that exact target.
 */
export function parseG1Target(env: Env): G1Target {
  const missing = Object.values(G1_ENV).filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new G1TargetError(`Missing required G1 variables: ${missing.join(", ")}`);
  }
  const admin = parseConnectionUrl(G1_ENV.admin, env[G1_ENV.admin]);
  const pub = parseConnectionUrl(G1_ENV.public, env[G1_ENV.public]);
  const priv = parseConnectionUrl(G1_ENV.private, env[G1_ENV.private]);
  for (const [variable, connection] of [
    [G1_ENV.public, pub],
    [G1_ENV.private, priv],
  ] as const) {
    if (
      connection.host !== admin.host ||
      connection.port !== admin.port ||
      connection.database !== admin.database
    ) {
      throw new G1TargetError(`${variable} must use the same host, port and database as admin`);
    }
  }
  if (!PUBLIC_ROLE_NAME.test(pub.user)) {
    throw new G1TargetError(`${G1_ENV.public} user must match ${PUBLIC_ROLE_NAME.source}`);
  }
  if (!PRIVATE_ROLE_NAME.test(priv.user)) {
    throw new G1TargetError(`${G1_ENV.private} user must match ${PRIVATE_ROLE_NAME.source}`);
  }
  if (PUBLIC_ROLE_NAME.test(admin.user) || PRIVATE_ROLE_NAME.test(admin.user)) {
    throw new G1TargetError(`${G1_ENV.admin} user must not be a runtime role name`);
  }
  if (new Set([admin.user, pub.user, priv.user]).size !== 3) {
    throw new G1TargetError("Admin, public and private users must be distinct");
  }
  if (!pub.password || !priv.password) {
    throw new G1TargetError("Public and private runtime URLs must carry a password");
  }
  if (pub.password === priv.password) {
    throw new G1TargetError("Public and private runtime passwords must differ");
  }
  if (env[G1_ENV.ack] !== expectedAck(admin.host, admin.port, admin.database)) {
    throw new G1TargetError(
      `${G1_ENV.ack} must equal "disposable-g1-target:<host>:<port>/<database>" for this target`,
    );
  }
  return {
    host: admin.host,
    port: admin.port,
    database: admin.database,
    admin,
    public: pub,
    private: priv,
  };
}

/** Runtime-only view handed to the role suite: no admin credential, only its role name. */
export type G1RuntimeTargets = {
  readonly public: G1Connection;
  readonly private: G1Connection;
  readonly adminRole: string;
};

export const G1_RUNTIME_ENV = { adminRole: "G1_ADMIN_ROLE_NAME" } as const;

export function parseRuntimeTargets(env: Env): G1RuntimeTargets {
  const missing = [G1_ENV.public, G1_ENV.private, G1_RUNTIME_ENV.adminRole].filter(
    (name) => !env[name]?.trim(),
  );
  if (missing.length > 0) {
    throw new G1TargetError(`Missing required G1 variables: ${missing.join(", ")}`);
  }
  if (env[G1_ENV.admin] !== undefined) {
    throw new G1TargetError(`${G1_ENV.admin} must not be present in a runtime test process`);
  }
  const pub = parseConnectionUrl(G1_ENV.public, env[G1_ENV.public]);
  const priv = parseConnectionUrl(G1_ENV.private, env[G1_ENV.private]);
  const adminRole = env[G1_RUNTIME_ENV.adminRole]!;
  if (!SAFE_IDENTIFIER.test(adminRole)) {
    throw new G1TargetError(`${G1_RUNTIME_ENV.adminRole} must be a lower-case identifier`);
  }
  if (!PUBLIC_ROLE_NAME.test(pub.user) || !PRIVATE_ROLE_NAME.test(priv.user)) {
    throw new G1TargetError("Runtime URLs must use the expected public/private role names");
  }
  if (
    pub.host !== priv.host ||
    pub.port !== priv.port ||
    pub.database !== priv.database ||
    new Set([pub.user, priv.user, adminRole]).size !== 3
  ) {
    throw new G1TargetError("Runtime URLs must share one target and use distinct roles");
  }
  return { public: pub, private: priv, adminRole };
}

/** Canonical Prisma URL for a validated connection (rebuilt, never the raw input). */
export function prismaUrl(connection: G1Connection): string {
  const user = encodeURIComponent(connection.user);
  const password = encodeURIComponent(connection.password);
  return `postgresql://${user}:${password}@${connection.host}:${connection.port}/${connection.database}?schema=public`;
}
