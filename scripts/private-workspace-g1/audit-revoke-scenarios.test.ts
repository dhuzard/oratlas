import { expect, it } from "vitest";
import {
  AUDIT_REVOKE_SCENARIOS,
  AUDIT_REVOKE_PROGRAM,
  AUDIT_REVOKE_TARGETS,
} from "./audit-revoke-scenarios.js";
import { auditRevokeDisclosureProblems, auditRevokeCookieSecrets } from "./audit-revoke-safety.js";
import { programProblems } from "./scenarios.js";
import { PRINCIPAL_LABELS, principalSessionProblems } from "./principals.js";
import { PUBLIC_TABLE_GRANTS, PUBLIC_COLUMN_UPDATE_GRANTS } from "./sql.js";
import { WORKER_READ_FIXTURE_DELTAS } from "./worker-read-scenarios.js";
it("declares six real-cookie principals and exactly two admin audit-producing outcomes", () => {
  expect(programProblems(AUDIT_REVOKE_SCENARIOS)).toEqual([]);
  expect(AUDIT_REVOKE_SCENARIOS).toHaveLength(92);
  expect(
    AUDIT_REVOKE_SCENARIOS.reduce<Record<string, number>>(
      (counts, s) => ((counts[s.expect.status] = (counts[s.expect.status] ?? 0) + 1), counts),
      {},
    ),
  ).toEqual({ 200: 2, 401: 12, 403: 52, 404: 2, 415: 24 });
  for (const target of AUDIT_REVOKE_TARGETS) {
    const own = AUDIT_REVOKE_SCENARIOS.filter((s) =>
      s.route.includes(`${target.kind}-credentials`),
    );
    expect(new Set(own.map((s) => s.principal))).toEqual(new Set(PRINCIPAL_LABELS));
    const positive = own.filter((s) => s.expect.status === 200);
    expect(positive).toHaveLength(1);
    expect(positive[0]!.principal).toBe("ADMIN");
    expect(positive[0]!.params.id).toBe(target.id);
    expect(positive[0]!.expect.bodyEquals).toBe('{"revoked":true}');
    expect(
      new Set(own.filter((s) => s.id.includes("-session-")).map((s) => s.session.case)),
    ).toEqual(new Set(["malformed", "signed-expired", "tampered", "signed-missing-user"]));
    for (const s of own) {
      expect(principalSessionProblems(s.principal, s.session.case, s.session)).toEqual([]);
      expect(s.method).toBe("POST");
      expect(s.workerAuthority).toBeUndefined();
      expect(s.headers).not.toHaveProperty("authorization");
      expect(s.expect.absentHeaders).toEqual(["set-cookie", "location"]);
      if (s.id.includes("missing-origin")) expect(s.headers).not.toHaveProperty("origin");
      if (s.id.includes("missing-media")) expect(s.headers).not.toHaveProperty("content-type");
    }
  }
});
it("reuses the exact worker37 fixture and existing audit INSERT without new revoke-column authority", () => {
  expect(AUDIT_REVOKE_PROGRAM.addedRows).toBe(WORKER_READ_FIXTURE_DELTAS);
  expect(Object.values(AUDIT_REVOKE_PROGRAM.addedRows).reduce((a, b) => a + b, 0)).toBe(37);
  expect(AUDIT_REVOKE_PROGRAM.fixtures).toEqual([
    "fixtures/worker-source-fixtures.sql",
    "fixtures/worker-fixtures.sql",
  ]);
  expect(PUBLIC_TABLE_GRANTS.find((g) => g.table === "AuditEvent")?.privileges).toEqual([
    "SELECT",
    "INSERT",
  ]);
  for (const table of ["VerifierCredential", "CertifierCredential"]) {
    expect(PUBLIC_TABLE_GRANTS.find((g) => g.table === table)?.privileges).toEqual(["SELECT"]);
    expect(PUBLIC_COLUMN_UPDATE_GRANTS.find((g) => g.table === table)?.columns).toEqual([
      "lastUsedAt",
    ]);
  }
});
it("refuses raw capability strings, JSON-escaped database components and nested sidecars before persistence", () => {
  const secret = [
    "synthetic",
    String.fromCharCode(34),
    "credential",
    String.fromCharCode(92),
    "component",
  ].join("");
  const rawCookie = "fixturePayload.fixtureSignature";
  expect(
    auditRevokeDisclosureProblems(
      { before: { public: [{ detailsJson: JSON.stringify({ message: secret }) }] }, after: {} },
      [secret],
    ),
  ).not.toEqual([]);
  expect(
    auditRevokeDisclosureProblems({ headers: { cookie: rawCookie } }, [rawCookie]),
  ).not.toEqual([]);
  expect(auditRevokeDisclosureProblems({ body: "oratlas_lease_syntheticLeak" }, [])).not.toEqual(
    [],
  );
  expect(auditRevokeDisclosureProblems({ [secret]: "public" }, [secret])).not.toEqual([]);
  const publicInput = {
    before: { rows: [{ actorId: "g1-user-admin" }] },
    request: { cookieSha256: "publicdigest" },
  };
  const before = JSON.stringify(publicInput);
  expect(auditRevokeDisclosureProblems(publicInput, [secret, rawCookie])).toEqual([]);
  expect(JSON.stringify(publicInput)).toBe(before);
});

it("guards actual native cookie payload/signature while retaining public identity fields", () => {
  const payload = "g1-user-admin.1774915200000";
  const signature = "synthetic-hmac-component";
  const value = `${payload}.${signature}`;
  const header = `oratlas_session=${value}`;
  const secrets = auditRevokeCookieSecrets(header);
  expect(secrets).toEqual([header, value, payload, signature]);
  for (const secret of secrets)
    expect(
      auditRevokeDisclosureProblems({ nested: JSON.stringify({ message: secret }) }, secrets),
    ).not.toEqual([]);
  expect(
    auditRevokeDisclosureProblems({ userId: "g1-user-admin", issuedAt: "1774915200000" }, secrets),
  ).toEqual([]);
  expect(() => auditRevokeCookieSecrets("oratlas_session=malformed")).toThrow("layout");
});
