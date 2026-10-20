import { describe, expect, it } from "vitest";
import {
  expectedAck,
  G1_ENV,
  G1TargetError,
  parseConnectionUrl,
  parseG1Target,
  parseRuntimeTargets,
  prismaUrl,
} from "./target.js";

// Offline: pure parsing only. No test here opens a connection.
const SECRET = "SuperSecretValue123";
const url = (user: string, password: string, rest = "localhost:55432/oratlas_g1") =>
  `postgresql://${user}:${password}@${rest}`;

function validEnv(): Record<string, string> {
  return {
    [G1_ENV.admin]: url("g1_admin", SECRET),
    [G1_ENV.public]: url("oratlas_g1_public", `${SECRET}-pub`),
    [G1_ENV.private]: url("oratlas_g1_private", `${SECRET}-priv`),
    [G1_ENV.ack]: expectedAck("localhost", 55432, "oratlas_g1"),
  };
}

function refusal(env: Record<string, string | undefined>): string {
  try {
    parseG1Target(env);
  } catch (error) {
    expect(error).toBeInstanceOf(G1TargetError);
    const message = (error as Error).message;
    expect(message).not.toContain(SECRET);
    return message;
  }
  throw new Error("expected the target to be refused");
}

describe("G1 disposable target validation", () => {
  it("accepts the narrowly allowed local disposable target", () => {
    const target = parseG1Target(validEnv());
    expect(target).toMatchObject({ host: "localhost", port: 55432, database: "oratlas_g1" });
    expect([target.admin.user, target.public.user, target.private.user]).toEqual([
      "g1_admin",
      "oratlas_g1_public",
      "oratlas_g1_private",
    ]);
    expect(prismaUrl(target.public)).toBe(
      `postgresql://oratlas_g1_public:${SECRET}-pub@localhost:55432/oratlas_g1?schema=public`,
    );
  });

  it("accepts 127.0.0.1, [::1] and Prisma's schema=public parameter", () => {
    for (const host of ["127.0.0.1", "[::1]"]) {
      const env = validEnv();
      for (const key of [G1_ENV.admin, G1_ENV.public, G1_ENV.private]) {
        env[key] = `${env[key]!.replace("localhost", host)}?schema=public`;
      }
      env[G1_ENV.ack] = expectedAck(host, 55432, "oratlas_g1");
      expect(parseG1Target(env).host).toBe(host);
    }
  });

  it("fails (never skips) when any dedicated variable is missing, naming only variables", () => {
    for (const name of Object.values(G1_ENV)) {
      const env: Record<string, string | undefined> = validEnv();
      delete env[name];
      expect(refusal(env)).toBe(`Missing required G1 variables: ${name}`);
    }
    expect(refusal({ DATABASE_URL: url("g1_admin", SECRET) })).toMatch(/Missing required G1/);
  });

  it.each([
    ["remote host", "db.example.com:5432/oratlas_g1"],
    ["lookalike host", "localhost.example.com:5432/oratlas_g1"],
    ["other loopback alias", "127.0.0.2:5432/oratlas_g1"],
    ["wildcard address", "0.0.0.0:5432/oratlas_g1"],
    ["upper-case opaque host", "LOCALHOST:5432/oratlas_g1"],
    ["percent-encoded host", "local%68ost:5432/oratlas_g1"],
    ["multi-host", "localhost:5432,db.example.com:5432/oratlas_g1"],
    ["implicit port", "localhost/oratlas_g1"],
    ["privileged port", "localhost:543/oratlas_g1"],
    ["arbitrary database", "localhost:5432/oratlas"],
    ["production-like database", "localhost:5432/postgres"],
    ["nested path", "localhost:5432/oratlas_g1/extra"],
    ["libpq host override", "localhost:5432/oratlas_g1?host=db.example.com"],
    ["libpq hostaddr override", "localhost:5432/oratlas_g1?hostaddr=10.0.0.1"],
    ["libpq service", "localhost:5432/oratlas_g1?service=prod"],
    ["libpq options", "localhost:5432/oratlas_g1?options=-csearch_path%3Dx"],
    ["non-public Prisma schema", "localhost:5432/oratlas_g1?schema=private_ws"],
    ["fragment", "localhost:5432/oratlas_g1#x"],
  ])("refuses a %s admin URL before any connection", (_label, rest) => {
    const env = validEnv();
    env[G1_ENV.admin] = url("g1_admin", SECRET, rest);
    expect(refusal(env)).toMatch(new RegExp(G1_ENV.admin));
  });

  it.each([
    ["mysql scheme", `mysql://g1_admin:${SECRET}@localhost:55432/oratlas_g1`],
    ["file URL", "file:./dev.db"],
    ["not a URL", "oratlas_g1"],
    ["leading whitespace", ` ${url("g1_admin", SECRET)}`],
    ["quoted identifier user", url('"G1 admin"', SECRET)],
    ["control character", url("g1_admin", `${SECRET}%0A`)],
  ])("refuses a malformed URL: %s", (_label, value) => {
    const env = validEnv();
    env[G1_ENV.admin] = value;
    refusal(env);
  });

  it("requires one shared server/database, distinct expected roles and passwords", () => {
    const otherDb = validEnv();
    otherDb[G1_ENV.public] = url("oratlas_g1_public", "p", "localhost:55432/oratlas_g1_other");
    expect(refusal(otherDb)).toMatch(/same host, port and database/);

    const otherPort = validEnv();
    otherPort[G1_ENV.private] = url("oratlas_g1_private", "q", "localhost:55433/oratlas_g1");
    expect(refusal(otherPort)).toMatch(/same host, port and database/);

    const wrongPublic = validEnv();
    wrongPublic[G1_ENV.public] = url("app_user", "p");
    expect(refusal(wrongPublic)).toMatch(/PUBLIC_DATABASE_URL user must match/);

    const swapped = validEnv();
    swapped[G1_ENV.public] = url("oratlas_g1_private", "p");
    expect(refusal(swapped)).toMatch(/PUBLIC_DATABASE_URL user must match/);

    const adminAsRuntime = validEnv();
    adminAsRuntime[G1_ENV.admin] = url("oratlas_g1_public_x", SECRET);
    expect(refusal(adminAsRuntime)).toMatch(/must not be a runtime role/);

    const noPassword = validEnv();
    noPassword[G1_ENV.public] = "postgresql://oratlas_g1_public@localhost:55432/oratlas_g1";
    expect(refusal(noPassword)).toMatch(/must carry a password/);

    const samePassword = validEnv();
    samePassword[G1_ENV.private] = url("oratlas_g1_private", `${SECRET}-pub`);
    expect(refusal(samePassword)).toMatch(/passwords must differ/);
  });

  it("requires an acknowledgement that names this exact target", () => {
    for (const ack of [
      "yes",
      "disposable-g1-target:localhost:5432/oratlas_g1",
      "disposable-g1-target:127.0.0.1:55432/oratlas_g1",
      ` ${expectedAck("localhost", 55432, "oratlas_g1")}`,
    ]) {
      const env = validEnv();
      env[G1_ENV.ack] = ack;
      expect(refusal(env)).toMatch(new RegExp(G1_ENV.ack));
    }
  });

  it("parses one URL and reports value-free errors", () => {
    expect(() => parseConnectionUrl("X", undefined)).toThrow("X is not set");
    expect(() => parseConnectionUrl("X", url("g1_admin", SECRET, "evil.example:1/x"))).toThrow(
      /^X must target a loopback host/,
    );
  });
});

describe("runtime-only targets for the T-ROLE child process", () => {
  const runtimeEnv = () => ({
    [G1_ENV.public]: url("oratlas_g1_public", "a"),
    [G1_ENV.private]: url("oratlas_g1_private", "b"),
    G1_ADMIN_ROLE_NAME: "g1_admin",
  });

  it("accepts public/private URLs and the admin role name only", () => {
    expect(parseRuntimeTargets(runtimeEnv()).adminRole).toBe("g1_admin");
  });

  it("refuses when the admin credential is present or the admin name is missing/unsafe", () => {
    expect(() =>
      parseRuntimeTargets({ ...runtimeEnv(), [G1_ENV.admin]: url("g1_admin", SECRET) }),
    ).toThrow(/must not be present/);
    expect(() => parseRuntimeTargets({ ...runtimeEnv(), G1_ADMIN_ROLE_NAME: "" })).toThrow(
      /Missing required G1 variables: G1_ADMIN_ROLE_NAME/,
    );
    expect(() =>
      parseRuntimeTargets({ ...runtimeEnv(), G1_ADMIN_ROLE_NAME: 'x"; DROP ROLE y; --' }),
    ).toThrow(/lower-case identifier/);
  });
});
