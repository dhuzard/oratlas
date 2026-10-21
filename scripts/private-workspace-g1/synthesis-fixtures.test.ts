import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import {
  canonicalJson,
  claimRecordSchema,
  citationRecordSchema,
  relationRecordSchema,
  publicSynthesisReviewSchema,
  subgraphEvidencePacketSchema,
  synthesisGenerationRequestSchema,
  synthesisDraftDecisionSchema,
} from "../../packages/contracts/src/index.js";
import {
  assertCanonicalPreparedPacket,
  composeDeterministicSynthesis,
  verifySynthesisDocument,
} from "../../packages/knowledge/src/synthesis-writer.js";
import {
  parseCoarNotifyActivity,
  announceReviewSchema,
} from "../../packages/federation/src/index.js";
import { programProblems } from "./scenarios.js";
import { PRINCIPAL_LABELS } from "./principals.js";
import { SYNTHESIS_SCENARIOS } from "./synthesis-scenarios.js";
import {
  SYNTHESIS_FIXTURE_COUNTS,
  SYNTHESIS_ROUTE_MODULES,
  SYNTHESIS_SLUG,
} from "./synthesis-routes.js";
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/synthesis-native.json", import.meta.url), "utf8"),
);
const sql = readFileSync(new URL("./fixtures/synthesis-fixtures.sql", import.meta.url), "utf8");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const draft = fixture.rows.SynthesisDraft[0];
const prepared = () =>
  assertCanonicalPreparedPacket({
    packet: subgraphEvidencePacketSchema.parse(JSON.parse(draft.packetJson)),
    json: draft.packetJson,
    sha256: draft.packetHash,
  });

it("replays the actual native deterministic document from its exact canonical packet", () => {
  expect(
    synthesisGenerationRequestSchema.parse(fixture.nativeGenerationInput).selector.selection,
  ).toEqual({ kind: "seed", nodeId: "g1-synthesis-source" });
  synthesisDraftDecisionSchema.parse(fixture.nativeAcceptanceInput);
  const packet = prepared();
  const document = verifySynthesisDocument(JSON.parse(draft.documentJson), packet);
  expect(composeDeterministicSynthesis(packet)).toEqual(document);
  expect(canonicalJson(document)).toBe(draft.documentJson);
  expect(hash(draft.documentJson)).toBe(draft.documentHash);
  expect(document.sections).toHaveLength(6);
  expect(fixture.rows.SynthesisDraftCitation).toHaveLength(1);
  const run = fixture.rows.AgentRun[0];
  expect(run).toMatchObject({
    status: "succeeded",
    humanReviewStatus: "approved",
    packetHash: draft.packetHash,
    promptHash: draft.promptHash,
    modelProvider: "deterministic",
  });
  expect(draft.status).toBe("accepted");
  expect(draft.revision).toBe(1);
});
it("rejects tampered packet hashes and nonexistent source citations through native validators", () => {
  expect(() => assertCanonicalPreparedPacket({ ...prepared(), sha256: "0".repeat(64) })).toThrow();
  const document = JSON.parse(draft.documentJson);
  document.sections[1].paragraphs[0].citations[0].nodeVersionId = "not-in-the-packet";
  expect(() => verifySynthesisDocument(document, prepared())).toThrow();
});
it("retains genuine source provenance and separates approving editor from software attribution", () => {
  const node = prepared().packet.nodes[0]!;
  const source = fixture.rows.KnowledgeNodeVersion.find(
    (v: { id: string }) => v.id === node.versionId,
  );
  expect(JSON.parse(source.provenanceJson)).toEqual(node.provenance);
  expect(node.provenance.commitSha).toBe(node.commitSha);
  expect(node.provenance.repositoryUrl).toBe(node.repository.url);
  expect(fixture.rows.SynthesisAttributionContributor).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "software-agent",
        role: "synthesis-generation",
        userId: null,
      }),
      expect.objectContaining({
        kind: "approving-editor",
        role: "editorial-approval",
        userId: "g1-user-admin",
        userRoleSnapshot: "ADMIN",
      }),
    ]),
  );
  const dto = publicSynthesisReviewSchema.parse(fixture.publicSynthesis);
  expect(dto.slug).toBe(SYNTHESIS_SLUG);
  expect(dto.provenance.approvingEditor.githubLogin).toBe("g1-fixture-admin");
  expect(dto.freshness.status).toBe("unchecked");
  expect(dto.citations).toHaveLength(1);
  expect(fixture.rows.ReviewVersion[0]).toMatchObject({
    snapshotId: null,
    versionDoi: null,
    conceptDoi: null,
    isExample: false,
    recordSourceType: "synthesis",
  });
});
it("binds accepted AnnounceReview payload bytes to native schema and storage hash", () => {
  const row = fixture.notification;
  const payload = JSON.parse(row.payloadJson);
  announceReviewSchema.parse(payload);
  parseCoarNotifyActivity(payload);
  expect(row.payloadJson).toBe(canonicalJson(payload));
  expect(row.payloadHash).toBe(hash(row.payloadJson));
  expect(row).toMatchObject({
    direction: "inbound",
    status: "accepted",
    pattern: "announce-review",
  });
  expect(payload.object.id).toContain(SYNTHESIS_SLUG);
});
it("validates populated comparison records as native source artifacts with opposite relations", () => {
  for (const c of fixture.comparisonRows.Claim)
    claimRecordSchema.parse({
      id: c.localClaimId,
      text: c.text,
      claimType: c.claimType,
      scope: JSON.parse(c.scopeJson),
    });
  for (const c of fixture.comparisonRows.Citation)
    citationRecordSchema.parse({ id: c.localCitationId, doi: c.doi, title: c.title, year: c.year });
  for (const r of fixture.comparisonRows.ClaimEvidenceRelation)
    relationRecordSchema.parse({
      claimId: r.claimId,
      citationId: r.citationId,
      relationType: r.relationType,
      supportDirection: r.supportDirection,
      humanReviewed: r.humanReviewed,
    });
  expect(
    fixture.comparisonRows.ClaimEvidenceRelation.slice(0, 2).map(
      (r: { relationType: string }) => r.relationType,
    ),
  ).toEqual(["supports", "contradicts"]);
  expect(new Set(fixture.comparisonRows.Citation.map((r: { doi: string }) => r.doi)).size).toBe(1);
});
it("keeps SQL exact to native captured rows and explicit additive fixture counts", () => {
  const actual: Record<string, Record<string, unknown>[]> = {};
  for (const match of sql.matchAll(
    /INSERT INTO "([A-Za-z]+)" \(([\s\S]*?)\) VALUES \(([\s\S]*?)\);/gu,
  )) {
    const columns = [...match[2]!.matchAll(/"([^"]+)"/gu)].map((m) => m[1]!);
    const values = [...match[3]!.matchAll(/'(?:''|[^'])*'|NULL|true|false|-?\d+/gu)].map((m) =>
      m[0].startsWith("'")
        ? m[0].slice(1, -1).replaceAll("''", "'")
        : m[0] === "NULL"
          ? null
          : m[0] === "true"
            ? true
            : m[0] === "false"
              ? false
              : Number(m[0]),
    );
    expect(values.length).toBe(columns.length);
    (actual[match[1]!] ??= []).push(Object.fromEntries(columns.map((c, i) => [c, values[i]])));
  }
  const expected = {
    ...fixture.rows,
    ...fixture.comparisonRows,
    FederationNotification: [fixture.notification],
  };
  for (const [table, rows] of Object.entries(expected)) {
    const expectedRows = (rows as Record<string, unknown>[]).map((r) =>
      table === "Review" ? { ...r, currentSynthesisVersionId: null } : r,
    );
    expect(actual[table], table).toEqual(expect.arrayContaining(expectedRows));
    expect(actual[table], table).toHaveLength(
      SYNTHESIS_FIXTURE_COUNTS[table as keyof typeof SYNTHESIS_FIXTURE_COUNTS],
    );
  }
  expect(sql.match(/UPDATE /gu)).toHaveLength(1);
  expect(sql).toContain(
    `SET "currentSynthesisVersionId"='${fixture.rows.Review[0].currentSynthesisVersionId}'`,
  );
});
it("requires populated outcomes and hidden controls for all six principals in a separate program", () => {
  expect(programProblems(SYNTHESIS_SCENARIOS)).toEqual([]);
  for (const route of Object.keys(SYNTHESIS_ROUTE_MODULES))
    expect(
      new Set(SYNTHESIS_SCENARIOS.filter((s) => s.route === route).map((s) => s.principal)),
    ).toEqual(new Set(PRINCIPAL_LABELS));
  expect(SYNTHESIS_SCENARIOS).toHaveLength(108);
});
