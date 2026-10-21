import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { publicationVersionPacketSchema } from "../../packages/contracts/src/publication-version-packets.js";
import {
  claimVerificationRunSchema,
  issueVerifierCredentialSchema,
} from "../../packages/contracts/src/verification.js";
import { G1_FIXED_CLOCK } from "./capture.js";
import { PRINCIPAL_LABELS } from "./principals.js";
import { workerReadScenarios } from "./worker-read-scenarios.js";
import { workerCredential, workerLease, workerAuthorityProblems } from "./worker-authority.js";
const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const sql = fixture("worker-fixtures.sql");
const runOverrides = [...sql.matchAll(/to_jsonb\(r\) \|\| '((?:''|[^'])*)'::jsonb/gu)].map(
  (match) => JSON.parse(match[1]!.replaceAll("''", "'")) as Record<string, unknown>,
);

it("requires four real worker GET successes with every cookie principal, plus bounded scope/expiry denials", () => {
  const scenarios = workerReadScenarios();
  expect(scenarios).toHaveLength(270);
  expect(new Set(scenarios.map((s) => s.id)).size).toBe(270);
  for (const principal of PRINCIPAL_LABELS) {
    const own = scenarios.filter((s) => s.principal === principal);
    expect(own).toHaveLength(45);
    expect(own.filter((s) => s.expect.status === 200)).toHaveLength(4);
    expect(new Set(own.filter((s) => s.expect.status === 200).map((s) => s.route)).size).toBe(4);
    for (const s of own) expect(workerAuthorityProblems(s.workerAuthority)).toEqual([]);
    expect(own.some((s) => s.id.includes("out-of-frozen-scope") && s.expect.status === 403)).toBe(
      true,
    );
    expect(own.filter((s) => s.id.includes("run-expired") && s.expect.status === 403)).toHaveLength(
      2,
    );
    expect(
      own.filter((s) => s.id.includes("run-terminal") && s.expect.status === 403),
    ).toHaveLength(2);
  }
});
it("binds immutable worker input to the native packet schema, internal digest and exact new subject", () => {
  const packet = publicationVersionPacketSchema.parse(JSON.parse(fixture("worker-input.json")));
  const { sha256, ...without } = packet;
  expect(sha256).toBe(sha(canonicalJson(without)));
  expect(packet.version.id).toBe("g1-worker-version");
  expect(packet.captures).toHaveLength(2);
  expect(packet.occurrences[0]!.canonicalBinding).toBeNull();
  expect(runOverrides).toHaveLength(3);
  for (const row of runOverrides) {
    expect(row.publicationVersionId).toBe(packet.version.id);
    expect(row.inputJson).toBe(canonicalJson(packet));
    expect(row.inputSha256).toBe(sha(canonicalJson(packet)));
    expect(row.claimedVerifierId).toBe("g1-worker-verifier-primary");
    expect(row.leaseTokenHash).toBe(sha(workerLease()));
    const seconds =
      (Date.parse(row.leaseExpiresAt as string) - Date.parse(row.leaseIssuedAt as string)) / 1000;
    expect(claimVerificationRunSchema.parse({ leaseSeconds: seconds }).leaseSeconds).toBe(300);
    expect(Date.parse(row.requestedAt as string)).toBeLessThanOrEqual(
      Date.parse(row.claimedAt as string),
    );
    expect(row.leaseGeneration).toBe(1);
  }
  expect(
    runOverrides.find((r) => r.id === "g1-worker-run-active")!.leaseExpiresAt! > G1_FIXED_CLOCK,
  ).toBe(true);
  expect(runOverrides.find((r) => r.id === "g1-worker-run-expired")!.leaseExpiresAt).toBe(
    G1_FIXED_CLOCK,
  );
  expect(runOverrides.find((r) => r.id === "g1-worker-run-terminal")!.status).toBe("failed");
  expect(runOverrides.find((r) => r.id === "g1-worker-run-terminal")!.terminalReason).toBe(
    "Synthetic terminal control.",
  );
  expect(sql).toContain('"reason":null');
  expect(sql).toContain('"reason":"Synthetic terminal control."');
});
it("stores credential digests only, preserves native shape checks and has no shared fixture mutations", () => {
  for (const kind of ["verifier", "certifier"] as const)
    for (const name of [
      "active",
      "wrong-owner",
      "submit-only",
      "expired",
      "revoked",
      "inactive",
    ] as const) {
      const value = workerCredential(kind, name);
      expect(sql).toContain(value.tokenPrefix);
      expect(sql).toContain(value.tokenHash);
      expect(sql).not.toContain(value.token);
      expect(sql).not.toContain(value.token.split(".")[1]);
    }
  expect(sql).not.toContain(workerLease());
  for (const file of [sql, fixture("worker-source-fixtures.sql")]) {
    expect(file).not.toMatch(/^\s*(?:UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT|SET)\b/gmu);
    expect(file).not.toContain("private_ws");
  }
});

it("retains native claim/transition details and a coherent historical submit credential stamp", () => {
  const events = [
    ...sql.matchAll(/INSERT INTO "VerificationRunLifecycleEvent" .*? VALUES \((.*?)\);/gu),
  ].map((match) => {
    const values = [...match[1]!.matchAll(/'(?:''|[^'])*'|NULL/gu)].map((value) =>
      value[0] === "NULL" ? null : value[0].slice(1, -1).replaceAll("''", "'"),
    );
    return {
      id: values[0],
      run: values[1],
      kind: values[2],
      user: values[3],
      verifier: values[4],
      details: JSON.parse(values[5]!),
      time: values[6],
    };
  });
  expect(events).toHaveLength(10);
  for (const row of runOverrides) {
    const own = events.filter((event) => event.run === row.id);
    expect(own.map((event) => event.kind)).toEqual(
      row.status === "failed"
        ? ["requested", "claimed", "running", "failed"]
        : ["requested", "claimed", "running"],
    );
    expect(own[0]).toMatchObject({
      user: row.requestedById,
      verifier: null,
      time: row.requestedAt,
      details: {},
    });
    expect(own[1]).toMatchObject({
      user: null,
      verifier: row.claimedVerifierId,
      time: row.claimedAt,
      details: {
        credentialId: "g1-worker-verifier-submit-only",
        leaseGeneration: row.leaseGeneration,
        leaseExpiresAt: row.leaseExpiresAt,
      },
    });
    expect(own[2]).toMatchObject({
      user: null,
      verifier: row.claimedVerifierId,
      time: row.startedAt,
      details: { reason: null },
    });
    if (row.status === "failed")
      expect(own[3]).toMatchObject({
        time: row.completedAt,
        details: { reason: row.terminalReason },
      });
    expect(Date.parse(row.claimedAt as string)).toBeLessThan(Date.parse(G1_FIXED_CLOCK));
  }
  const credentialLine = sql
    .split("\n")
    .find(
      (line) =>
        line.startsWith('INSERT INTO "VerifierCredential"') &&
        line.includes("'g1-worker-verifier-submit-only'"),
    )!;
  const credentialValues = [...credentialLine.matchAll(/'(?:''|[^'])*'|NULL/gu)].map((value) =>
    value[0] === "NULL" ? null : value[0].slice(1, -1).replaceAll("''", "'"),
  );
  expect(
    issueVerifierCredentialSchema.parse({
      label: credentialValues[2],
      scopes: JSON.parse(credentialValues[5]!),
      expiresAt: credentialValues[6],
    }).scopes,
  ).toEqual(["verification:submit"]);
  expect(credentialValues[7]).toBeNull();
  expect(credentialValues[11]).toBe(
    events
      .filter((event) => event.verifier === credentialValues[1])
      .map((event) => event.time)
      .sort()
      .at(-1),
  );
  expect(credentialLine).toContain("'g1-worker-verifier-primary'");
  expect(credentialLine).toContain('["verification:submit"]');
  expect(credentialLine).toMatch(/,'2026-03-31T23:59:00.000Z'\);$/u);
});
