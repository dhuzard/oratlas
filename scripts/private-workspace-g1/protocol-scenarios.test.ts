import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { globalClaimId } from "../../packages/contracts/src/evidence-identity.js";
import { canonicalJson } from "../../packages/contracts/src/canonical-json.js";
import { publicationVersionPacketSchema } from "../../packages/contracts/src/publication-version-packets.js";
import { executionPassportRegistrationSchema } from "../../packages/contracts/src/execution-passports.js";
import {
  certificationProtocolDefinitionSchema,
  submitCertificationResultSchema,
} from "../../packages/contracts/src/certification.js";
import { submitVerificationFindingSchema } from "../../packages/contracts/src/verification.js";
import {
  parseTrustedExecutionKeys,
  verifyExecutionPassport,
} from "../../packages/execution-passports/src/index.js";
import { methodObligations } from "./obligations.js";
import { PRINCIPAL_LABELS } from "./principals.js";
import { programProblems } from "./scenarios.js";
import {
  PROTOCOL_ROUTES,
  PROTOCOL_WORKER_ONLY_ROUTES,
  PROTOCOL_FIXTURE_COUNT_DELTAS,
  PROTOCOL_SELECT_TABLES,
} from "./protocol-routes.js";
import {
  publicProtocolScenarios,
  PROTOCOL_ARTIFACT_TEXT,
  PROTOCOL_PRIVATE_ARTIFACT_CANARY,
} from "./protocol-scenarios.js";
const fixture = (name: string) =>
  readFileSync(new URL("./fixtures/" + name, import.meta.url), "utf8");
const sql = fixture("protocol-fixtures.sql");
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function rows(table: string): Record<string, string>[] {
  return [...sql.matchAll(/INSERT INTO "([A-Za-z]+)" \(([\s\S]*?)\) VALUES \(([\s\S]*?)\);/gu)]
    .filter((m) => m[1] === table)
    .map((m) => {
      const columns = [...m[2]!.matchAll(/"([^"]+)"/gu)].map((m) => m[1]!);
      const values = [...m[3]!.matchAll(/'(?:''|[^'])*'|NULL|true|false|\d+/gu)].map((m) =>
        m[0].startsWith("'") ? m[0].slice(1, -1).replaceAll("''", "'") : m[0],
      );
      expect(values).toHaveLength(columns.length);
      return Object.fromEntries(columns.map((c, i) => [c, values[i]!]));
    });
}
const row = (table: string, id: string) => {
  const found = rows(table).find((r) => r.id === id);
  if (!found) throw new Error(`Missing fixture ${table}/${id}`);
  return found;
};
const scenarios = publicProtocolScenarios();
describe("public protocol/execution read batch", () => {
  it("covers seven populated GETs and separately declares four worker-only denial gaps for all six principals", () => {
    expect(programProblems(scenarios)).toEqual([]);
    expect(scenarios).toHaveLength(162);
    expect(scenarios.filter((s) => s.expect.status === 200)).toHaveLength(54);
    expect(scenarios.filter((s) => s.expect.status === 404)).toHaveLength(72);
    expect(scenarios.filter((s) => s.expect.status === 401)).toHaveLength(30);
    expect(scenarios.filter((s) => s.expect.status === 409)).toHaveLength(6);
    for (const route of Object.keys(PROTOCOL_ROUTES))
      for (const principal of PRINCIPAL_LABELS) {
        const success = scenarios.filter(
          (s) => s.route === route && s.principal === principal && s.expect.status === 200,
        );
        expect(success.length, route + "/" + principal).toBeGreaterThan(0);
        expect(success.every((s) => Boolean(s.expect.json?.length || s.expect.bodyEquals))).toBe(
          true,
        );
      }
    for (const route of Object.keys(PROTOCOL_WORKER_ONLY_ROUTES)) {
      const requests = scenarios.filter((s) => s.route === route);
      expect(requests).toHaveLength(6);
      expect(requests.every((s) => s.expect.status === 401)).toBe(true);
    }
    for (const scenario of scenarios) {
      if (scenario.principal === "anonymous") expect(scenario.session.case).toBe("none");
      else {
        expect(scenario.session.case).toBe("valid");
        expect(scenario.expect.sameResponseAs).toBe(
          scenario.id.replace(/-(?:a-only|b-only|a-and-b|editor|admin)$/u, "-anonymous"),
        );
      }
    }
    const inventory = methodObligations(resolve(process.cwd(), "apps/web/src/app"), scenarios);
    expect(inventory.undeclaredScenarioOperations).toEqual([]);
    expect(inventory.routeMethodsWithScenarios).toBe(11);
    expect(inventory.routeMethodsWithAllPrincipalCases).toBe(11);
    expect(inventory.routeMethodsWithSuccessScenarios).toBe(7);
  });
  it("records exact added rows and permits only completion of its own newly inserted verification run", () => {
    for (const [table, count] of Object.entries(PROTOCOL_FIXTURE_COUNT_DELTAS))
      expect(rows(table), table).toHaveLength(count);
    const mutations = [...sql.matchAll(/^UPDATE .*;$/gmu)].map((m) => m[0]);
    expect(mutations).toEqual([
      'UPDATE "VerificationRun" SET "status" = \'completed\', "completedAt" = \'2026-04-01T00:00:00.000Z\' WHERE "id" = \'g1-protocol-verification-run\' AND "status" = \'running\';',
    ]);
    expect(sql).not.toMatch(/^\s*(?:DELETE|TRUNCATE|DROP|ALTER|GRANT|SET)\b/gmu);
    expect(sql).not.toContain("private_ws");
    expect(new Set(PROTOCOL_SELECT_TABLES).size).toBe(8);
  });
  it("requires exact public bytes, security/digest headers, private denials and invalid-record failures", () => {
    for (const s of scenarios.filter(
      (s) => s.id.startsWith("protocol-artifact-") && s.expect.status === 200,
    )) {
      expect(s.expect.bodyEquals).toBe(PROTOCOL_ARTIFACT_TEXT);
      expect(s.expect.headers).toMatchObject({
        "x-oratlas-sha256": sha256(PROTOCOL_ARTIFACT_TEXT),
        "cache-control": "public, immutable, max-age=31536000",
      });
    }
    for (const principal of PRINCIPAL_LABELS) {
      const own = scenarios.filter((s) => s.principal === principal);
      expect(
        own.filter((s) => s.id.includes("passport-tombstoned") && s.expect.status === 404),
      ).toHaveLength(1);
      expect(
        own.filter((s) => s.id.includes("passport-hidden") && s.expect.status === 404),
      ).toHaveLength(1);
      expect(
        own.filter((s) => s.id.includes("passport-tampered") && s.expect.status === 404),
      ).toHaveLength(1);
      expect(
        own.filter(
          (s) =>
            s.id.includes("artifact-private") &&
            s.expect.status === 401 &&
            s.expect.bodyExcludes?.includes(PROTOCOL_PRIVATE_ARTIFACT_CANARY),
        ),
      ).toHaveLength(1);
      expect(
        own.filter((s) => s.id.includes("artifact-tampered") && s.expect.status === 409),
      ).toHaveLength(1);
    }
  });
});
describe("native protocol fixture validity and binding", () => {
  it("verifies committed signatures with exact public test keys and rejects tampering/unknown trust", () => {
    const native = JSON.parse(fixture("protocol-passports.json")) as Array<{
      id: string;
      bindingClaimId: string;
      source: unknown;
    }>;
    const trusted = parseTrustedExecutionKeys(fixture("protocol-trusted-keys.json"));
    expect(trusted).toHaveLength(4);
    expect(fixture("protocol-passports.json")).not.toContain("PRIVATE KEY");
    for (const f of native) {
      const db = row("ExecutionPassport", f.id);
      expect(JSON.parse(db.sourceJson!)).toEqual(f.source);
      const source = executionPassportRegistrationSchema.parse(f.source);
      if (f.id.endsWith("tampered")) {
        expect(() => verifyExecutionPassport(source, trusted)).toThrow();
        continue;
      }
      if (f.id.endsWith("unknown-key")) {
        expect(() => verifyExecutionPassport(source, trusted)).toThrow();
        const untrusted = parseTrustedExecutionKeys(
          JSON.stringify([JSON.parse(fixture("protocol-untrusted-key.json"))]),
        );
        expect(verifyExecutionPassport(source, untrusted).checks.signature).toBe("verified");
        continue;
      }
      const verified = verifyExecutionPassport(
        source,
        trusted,
        new Date("2026-04-01T00:00:00.000Z"),
      );
      expect(() => verifyExecutionPassport(source, [])).toThrow();
      expect(db.crateSha256).toBe(verified.crateSha256);
      expect(db.attestationSha256).toBe(verified.attestationSha256);
      expect(db.payloadSha256).toBe(verified.payloadSha256);
      expect(db.repositoryUrl).toBe(verified.repository.url);
      expect(db.commitSha).toBe(verified.repository.commitSha);
      expect(db.treeSha).toBe(verified.repository.treeSha);
      expect(db.status).toBe(verified.status);
      expect(db.verificationStatus).toBe("verified");
      expect(db.workflowEntityId).toBe(verified.workflow.entityId);
      expect(db.workflowPath).toBe(verified.workflow.path);
      expect(Number(db.workflowRunAttempt)).toBe(verified.workflow.runAttempt);
      expect(db.workflowSha256).toBe(verified.workflow.sha256);
      expect(db.workflowRunId).toBe(verified.workflow.runId);
      expect(db.signingKeyId).toBe(verified.signingIdentity.keyId);
      expect(db.signingIssuer).toBe(verified.signingIdentity.issuer);
      expect(db.signingSubject).toBe(verified.signingIdentity.subject);
      expect(db.issuedAt).toBe(verified.issuedAt);
      expect(
        rows("ExecutionPassportClaim")
          .filter((r) => r.passportId === f.id)
          .map((r) => r.claimId),
      ).toEqual([f.bindingClaimId]);
      const binding = {
        "g1-claim-2": { versionId: "g1-version-4", localClaimId: "claim-1" },
        "g1-claim-control": { versionId: "g1-version-3", localClaimId: "claim-1" },
        "g1-discovery-claim-tombstoned": {
          versionId: "g1-version-tombstoned",
          localClaimId: "discovery-claim",
        },
      }[f.bindingClaimId];
      expect(binding).toBeDefined();
      expect(verified.claims).toEqual([
        { ...binding, claimId: globalClaimId(binding!.versionId, binding!.localClaimId) },
      ]);
      const artifacts = rows("ExecutionPassportArtifact")
        .filter((r) => r.passportId === f.id)
        .map((r) => ({
          entityId: r.entityId,
          role: r.role,
          name: r.name,
          path: r.path,
          mediaType: r.mediaType,
          byteSize: Number(r.byteSize),
          sha256: r.sha256,
        }));
      expect(artifacts).toEqual(verified.artifacts);
    }
  });
  it("uses one valid production-built native packet for both immutable input snapshots", () => {
    const input = publicationVersionPacketSchema.parse(JSON.parse(fixture("protocol-input.json")));
    const { sha256: packetDigest, ...withoutDigest } = input;
    expect(packetDigest).toBe(sha256(canonicalJson(withoutDigest)));
    for (const [table, id, field, hash] of [
      ["VerificationRun", "g1-protocol-verification-run", "inputJson", "inputSha256"],
      ["CertificationRun", "g1-protocol-certification-run", "inputPacketJson", "inputPacketSha256"],
    ] as const) {
      const db = row(table, id);
      expect(JSON.parse(db[field]!)).toEqual(input);
      expect(db[hash]).toBe(sha256(canonicalJson(input)));
    }
    expect(input.occurrences[0]?.canonicalBinding).toBeNull();
    expect(fixture("protocol-input.json")).not.toContain("contentBytes");
  });
  it("preserves native finding/result payloads, exact digests, evidence links and protocol-owned outcomes", () => {
    const findings = JSON.parse(fixture("protocol-findings.json")) as unknown[];
    for (const [i, raw] of findings.entries()) {
      const finding = submitVerificationFindingSchema.parse(raw);
      const db = rows("VerificationFinding")[i]!;
      expect(JSON.parse(db.payloadJson!)).toEqual(finding);
      expect(db.payloadSha256).toBe(sha256(canonicalJson(finding)));
      expect(JSON.parse(db.evidenceRefsJson!)).toEqual(finding.evidenceRefs);
      expect(finding.artifactRefs).toEqual(["g1-protocol-artifact-public"]);
      expect(
        rows("VerificationFindingArtifact")
          .filter((r) => r.verificationFindingId === db.id)
          .map((r) => r.verificationArtifactId),
      ).toEqual(finding.artifactRefs);
    }
    const result = submitCertificationResultSchema.parse(
      JSON.parse(fixture("protocol-result.json")),
    );
    const db = row("CertificationResult", "g1-protocol-certification-result");
    expect(JSON.parse(db.resultJson!)).toEqual(result);
    expect(db.resultSha256).toBe(sha256(canonicalJson(result)));
    expect(result.packetSha256).toBe(db.inputPacketSha256);
    const protocolSql = fixture("editorial-fixtures.sql");
    const definitionMatch = protocolSql.match(/'(\{"assessmentModes"[^']+)'/u);
    expect(definitionMatch).not.toBeNull();
    const definition = certificationProtocolDefinitionSchema.parse(
      JSON.parse(definitionMatch![1]!),
    );
    expect(definition.outcomes).toContain(result.outcome);
    expect(result.outcome).toBe("inconclusive");
    expect(result.independence.declared).toBe(false);
    expect(result.criteria.map((c) => c.criterionId)).toEqual(definition.criteria.map((c) => c.id));
    expect(rows("CertificationLifecycleEvent").map((r) => r.kind)).toEqual(["issued", "withdrawn"]);
  });
  it("binds stored public/private artifact bytes and explicitly distinguishes the corrupt control", () => {
    const artifacts = rows("VerificationArtifact");
    const blobs = rows("VerificationArtifactBlob");
    expect(artifacts).toHaveLength(4);
    expect(blobs).toHaveLength(3);
    for (const artifact of artifacts) {
      const blob = blobs.find((b) => b.artifactId === artifact.id);
      if (artifact.status === "prepared") {
        expect(blob).toBeUndefined();
        continue;
      }
      expect(blob).toBeDefined();
      const bytes = Buffer.from(blob!.bytes!.slice(2), "hex");
      expect(bytes.length).toBe(Number(artifact.byteLength));
      if (artifact.id!.endsWith("tampered")) expect(artifact.sha256).not.toBe(sha256(bytes));
      else expect(artifact.sha256).toBe(sha256(bytes));
    }
  });
});
