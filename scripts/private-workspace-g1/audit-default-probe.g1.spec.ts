import { writeFileSync } from "node:fs";
import { it, expect, vi } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { G1_FIXED_CLOCK } from "./capture.js";
import { assertPublicChildEnv } from "./child-env.js";
import {
  PUBLIC_SELECT_TABLES,
  PUBLIC_TABLE_GRANTS,
  PUBLIC_COLUMN_UPDATE_GRANTS,
  tablePrivilegesSql,
  columnPrivilegesSql,
} from "./sql.js";
import { readPublicSnapshot } from "./public-snapshot.js";
import { createNativeEvidenceGuard } from "./native-evidence-guard.js";
import { workerOutputProblems } from "./worker-capture-safety.js";
import {
  AuditDefaultFixture,
  AUDIT_DEFAULT_PROTOCOL,
  AUDIT_DEFAULT_TIME,
  AUDIT_DEFAULT_IDS,
} from "./audit-default-fixture.js";

it("retains native audit semantics with separately declared absent metadata input", async () => {
  const out = assertPublicChildEnv(process.env, "G1_AUDIT_DEFAULT_OUT");
  const mode = process.env.G1_AUDIT_DEFAULT_MODE;
  if (mode !== "unextended" && mode !== "fixed")
    throw Error("Explicit audit default probe mode required");
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(G1_FIXED_CLOCK) });
  let outbound = 0;
  vi.stubGlobal("fetch", () => {
    outbound++;
    throw Error("Audit fixture outbound request refused");
  });
  const native = await import("@oratlas/db");
  const base = native.getPrisma();
  const fixture = new AuditDefaultFixture();
  let delegatedQueries = 0;
  const extended =
    mode === "fixed"
      ? base.$extends({
          name: "g1-unwired-audit-default-input",
          query: {
            $allModels: {
              $allOperations({ model, operation, args, query }) {
                return fixture.query(model, operation, args, (prepared) => {
                  delegatedQueries++;
                  return query(prepared as typeof args);
                });
              },
            },
          },
        })
      : base;
  // Explicit test import binding only. Neither the singleton global nor native engine is changed.
  vi.doMock("@/lib/db", () => ({ prisma: extended, parseJsonColumn: native.parseJsonColumn }));
  const { audit } = await import("@/lib/audit");
  const bound = await import("@/lib/db");
  expect(bound.prisma).toBe(extended);
  const prisma = extended as unknown as typeof base;
  const { createSessionToken } = await import("@/lib/session-token");
  const snapshotGuard = createNativeEvidenceGuard(createSessionToken, process.env.DATABASE_URL!);
  const snapshot = async () => snapshotGuard.value(await readPublicSnapshot(prisma));

  try {
    const posture = (
      await prisma.$queryRawUnsafe<
        Array<{
          evidence: {
            user: string;
            current: string;
            privileged: boolean;
            memberships: number;
            owned: number;
            publicCreate: boolean;
            privateExists: boolean;
            tables: unknown[];
            columns: unknown[];
          };
        }>
      >(
        `SELECT json_build_object('user',session_user::text,'current',current_user::text,'privileged',(SELECT rolsuper OR rolinherit OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls FROM pg_roles WHERE rolname=session_user),'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=session_user)),'owned',(SELECT count(*) FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_type WHERE typowner=(SELECT oid FROM pg_roles WHERE rolname=session_user))+(SELECT count(*) FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname=session_user)),'publicCreate',has_schema_privilege(session_user,'public','CREATE'),'privateExists',to_regnamespace('private_ws') IS NOT NULL,'tables',${tablePrivilegesSql("session_user")},'columns',${columnPrivilegesSql("session_user")}) AS evidence`,
      )
    )[0]!.evidence;
    expect(posture.user).toBe(new URL(process.env.DATABASE_URL!).username);
    expect(posture.current).toBe(posture.user);
    expect(posture.privileged).toBe(false);
    expect(posture.memberships).toBe(0);
    expect(posture.owned).toBe(0);
    expect(posture.publicCreate).toBe(false);
    expect(posture.privateExists).toBe(false);
    const sorted = (values: unknown[]) => values.map((v) => canonicalJson(v)).sort();
    expect(sorted(posture.tables)).toEqual(
      sorted(
        PUBLIC_TABLE_GRANTS.flatMap(({ table, privileges }) => privileges.map((p) => [table, p])),
      ),
    );
    expect(sorted(posture.columns)).toEqual(
      sorted(
        PUBLIC_COLUMN_UPDATE_GRANTS.flatMap(({ table, columns }) =>
          columns.map((c) => [table, c, "UPDATE"]),
        ),
      ),
    );
    const before = await snapshot();
    const data = {
      actorId: "g1-user-a-only",
      action: "g1.audit-default.transaction",
      subjectType: "review",
      subjectId: "g1-review-1",
      detailsJson: '{"fixture":"native business input"}',
    };
    await audit("g1-user-a-only", "g1.audit-default.utility", "review", "g1-review-1", {
      fixture: "native business input",
    });
    await prisma.$transaction((tx) => tx.auditEvent.create({ data }));
    const explicitId = "g1-audit-default-explicit";
    const explicitTime = new Date("2001-02-03T04:05:06.000Z");
    await prisma.auditEvent.create({
      data: {
        ...data,
        action: "g1.audit-default.explicit",
        id: explicitId,
        createdAt: explicitTime,
      },
    });
    const rows = await prisma.auditEvent.findMany({
      where: { action: { startsWith: "g1.audit-default." } },
      orderBy: { action: "asc" },
    });
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.platformVersion !== null)).toBe(true);
    const { PLATFORM_VERSION } = await import("../../packages/config/src/index.js");
    expect(rows.every((row) => row.platformVersion === PLATFORM_VERSION)).toBe(true);
    const explicit = rows.find((row) => row.id === explicitId)!;
    expect(explicit.createdAt).toEqual(explicitTime);
    if (mode === "fixed") {
      const generated = rows.filter((row) => row.id !== explicitId);
      expect(new Set(generated.map((row) => row.id))).toEqual(
        new Set(AUDIT_DEFAULT_IDS.slice(0, 2)),
      );
      expect(generated.every((row) => row.createdAt.toISOString() === AUDIT_DEFAULT_TIME)).toBe(
        true,
      );
    }
    const afterPositive = await snapshot();
    const failure = async (operation: () => Promise<unknown>) => {
      try {
        await operation();
        throw Error("Native control unexpectedly succeeded");
      } catch (error) {
        if (error instanceof Error && error.message === "Native control unexpectedly succeeded")
          throw error;
        const value = error as { code?: string; meta?: { code?: string } };
        return { code: value.code ?? null, sqlstate: value.meta?.code ?? null };
      }
    };
    const duplicate = await failure(() =>
      prisma.auditEvent.create({ data: { ...data, id: explicitId, createdAt: explicitTime } }),
    );
    expect(duplicate.code).toBe("P2002");
    const foreignKey = await failure(() =>
      prisma.auditEvent.create({
        data: {
          ...data,
          id: "g1-audit-default-invalid-actor",
          actorId: "g1-audit-actor-missing",
          createdAt: explicitTime,
        },
      }),
    );
    expect(foreignKey.code).toBe("P2003");
    const deniedUpdate = await failure(() =>
      prisma.auditEvent.update({
        where: { id: explicitId },
        data: { detailsJson: '{"not":"written"}' },
      }),
    );
    const updatePermission = await failure(() =>
      prisma.$executeRawUnsafe(
        'UPDATE "AuditEvent" SET "detailsJson"=$1 WHERE id=$2',
        '{"not":"written"}',
        explicitId,
      ),
    );
    expect(updatePermission.sqlstate).toBe("42501");
    const rollback = Error("Synthetic rollback control");
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.auditEvent.create({ data: { ...data, action: "g1.audit-default.rollback" } });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    if (mode === "fixed") {
      const controls = [
        () =>
          prisma.user.create({
            data: { githubUserId: "g1-unwritten-user", githubLogin: "g1-unwritten-user" },
          }),
        () => prisma.auditEvent.createMany({ data: [data] }),
        () => prisma.auditEvent.createManyAndReturn({ data: [data] }),
        () =>
          prisma.auditEvent.upsert({
            where: { id: "g1-unwritten-upsert" },
            create: data,
            update: { detailsJson: "not written" },
          }),
        () =>
          prisma.auditEvent.create({
            data: {
              action: "not-written",
              subjectType: "fixture",
              subjectId: "not-written",
              actor: {
                create: { githubUserId: "g1-unwritten-nested", githubLogin: "g1-unwritten-nested" },
              },
            },
          }),
      ];
      for (const control of controls) {
        const queries = fixture.trace.length;
        await expect(control()).rejects.toThrow(
          /Unsupported audit fixture create|Nested audit fixture write refused/u,
        );
        expect(fixture.trace).toHaveLength(queries);
      }
      expect(fixture.trace.every((entry) => entry.queryCalls === 1)).toBe(true);
      expect(delegatedQueries).toBe(fixture.trace.length);
    }
    const after = await snapshot();
    expect(after).toEqual(afterPositive);
    for (const table of PUBLIC_SELECT_TABLES)
      if (table !== "AuditEvent") expect(after[table]).toEqual(before[table]);
    expect(after.AuditEvent!.length).toBe(before.AuditEvent!.length + 3);
    expect(outbound).toBe(0);
    const proof = {
      protocol: AUDIT_DEFAULT_PROTOCOL,
      mode,
      clock: G1_FIXED_CLOCK,
      posture,
      rows,
      before,
      after,
      controls: {
        duplicate,
        foreignKey,
        deniedUpdate,
        updatePermission,
        rollback: true,
        unsupportedCreates: mode === "fixed" ? 5 : 0,
        appendOnlyBoundary:
          "Runtime INSERT/SELECT only; native schema has no AuditEvent UPDATE/DELETE trigger. Parent admin rollback control records this authority limit.",
      },
      queryTrace: fixture.trace,
      outbound,
    };
    const text = JSON.stringify(proof, null, 2) + "\n";
    const url = new URL(process.env.DATABASE_URL!);
    const secrets = [
      process.env.DATABASE_URL!,
      url.password,
      decodeURIComponent(url.password),
    ].filter(Boolean);
    const pending: unknown[] = [proof];
    let inspected = 0;
    while (pending.length) {
      if (++inspected > 250_000) throw Error("Audit fixture disclosure inspection bound refused");
      const value = pending.pop();
      if (typeof value === "string") {
        if (
          secrets.some(
            (secret) =>
              value.includes(secret) || value.includes(JSON.stringify(secret).slice(1, -1)),
          ) ||
          workerOutputProblems(value).length
        )
          throw Error("Audit fixture capability disclosure refused");
        if (value.trim().startsWith("{") || value.trim().startsWith("[")) {
          let parsed: unknown;
          try {
            parsed = JSON.parse(value);
          } catch {
            continue;
          }
          pending.push(parsed);
        }
      } else if (value && typeof value === "object") {
        for (const [key, entry] of Object.entries(value)) pending.push(key, entry);
      }
    }
    if (
      secrets.some(
        (secret) => text.includes(secret) || text.includes(JSON.stringify(secret).slice(1, -1)),
      ) ||
      workerOutputProblems(text).length
    )
      throw Error("Audit fixture capability disclosure refused");
    writeFileSync(out, text, { mode: 0o600, flag: "wx" });
  } finally {
    vi.doUnmock("@/lib/db");
    vi.useRealTimers();
    vi.unstubAllGlobals();
    await prisma.$disconnect();
  }
}, 120_000);
