import { describe, expect, it } from "vitest";
import {
  editorialSynthesisDraftSchema,
  publicSynthesisReviewSchema,
  synthesisRegenerationProposalSchema,
  synthesisDraftDecisionSchema,
  SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
  SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
  SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
  SYNTHESIS_PIPELINE_SOFTWARE_ID,
  SYNTHESIS_PIPELINE_SOFTWARE_NAME,
} from "./synthesis-editorial.js";
import {
  SYNTHESIS_REVIEW_SCHEMA_VERSION,
  SYNTHESIS_SECTION_IDS,
  SYNTHESIS_SECTION_TITLES,
} from "./synthesis-review.js";

const hash = "a".repeat(64);
const document = {
  schemaVersion: SYNTHESIS_REVIEW_SCHEMA_VERSION,
  title: "A grounded synthesis",
  summary: "A bounded evidence summary.",
  citations: [],
  sections: SYNTHESIS_SECTION_IDS.map((id, index) => ({
    id,
    title: SYNTHESIS_SECTION_TITLES[index],
    paragraphs: [{ text: `Grounded section ${index + 1}.`, citations: [] }],
  })),
};
const generation = {
  generationMode: "deterministic-template",
  pipelineSoftware: {
    id: SYNTHESIS_PIPELINE_SOFTWARE_ID,
    kind: "software-agent",
    displayName: SYNTHESIS_PIPELINE_SOFTWARE_NAME,
    pipelineVersion: "kg12-v1",
  },
  provider: "deterministic",
  model: "grounded-template",
  modelVersion: "unavailable",
  promptVersion: "synthesis-prompt/1.0.0",
  promptHash: hash,
  packetHash: hash,
  documentHash: hash,
  generatedAt: "2026-07-16T10:00:00.000Z",
  attributionPolicyVersion: SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
  materializationPolicyVersion: SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
};

describe("synthesis editorial contracts", () => {
  it("normalizes distinct live DOIs and rejects reserved or duplicate identifiers", () => {
    const decision = {
      action: "accept" as const,
      expectedRevision: 0,
      idempotencyKey: "accept-doi-contract-0001",
      rationale: "The editor completed every required publication and grounding check.",
      licenseSpdx: "CC-BY-4.0",
      rightsStatement: "The editor confirms publication rights for this synthesis.",
      versionDoi: "10.5281/ZENODO.1234567",
      conceptDoi: "10.5281/ZENODO.1234500",
      checklist: {
        groundingAndCitationsReviewed: true,
        contradictionAndNonConsensusFramingReviewed: true,
        attributionAndAiDisclosureReviewed: true,
        limitationsReviewed: true,
        privacyAndInjectionLeakageReviewed: true,
        rightsAndLicenseConfirmed: true,
      },
    };
    expect(synthesisDraftDecisionSchema.parse(decision)).toMatchObject({
      versionDoi: "10.5281/zenodo.1234567",
      conceptDoi: "10.5281/zenodo.1234500",
    });
    expect(
      synthesisDraftDecisionSchema.safeParse({
        ...decision,
        conceptDoi: decision.versionDoi.toLowerCase(),
      }).success,
    ).toBe(false);
    expect(
      synthesisDraftDecisionSchema.safeParse({ ...decision, versionDoi: "10.5555/example.v1" })
        .success,
    ).toBe(false);
  });

  it("accepts a private pending generation without acceptance provenance", () => {
    expect(
      editorialSynthesisDraftSchema.safeParse({
        id: "draft-1",
        status: "pending",
        revision: 0,
        seriesKey: hash,
        selector: {
          schemaVersion: "synthesis-selector/1.0.0",
          selection: { kind: "seed", nodeId: "node-1" },
          depth: 1,
          maxNodes: 10,
          maxEdges: 20,
          relationTypes: ["contradicts"],
          trustPolicy: "authoritative-current-relation-trust-v1",
          currentVersionPolicy: "newest-valid-no-history-fallback",
          topicSeedPolicy: "current-public-title-abstract-search-v1",
          topicSeedLimit: 1,
          edgePolicy: "editor-confirmed-exact-versions-only",
          includeContradictions: true,
        },
        generationKey: hash,
        regenerationOrdinal: 1,
        document,
        provenance: generation,
        citations: [],
      }).success,
    ).toBe(true);
  });

  it("requires every acceptance and lineage field on public provenance", () => {
    const publicValue = {
      slug: "synthesis-1",
      reviewType: "ai-synthesis",
      title: document.title,
      abstract: document.summary,
      document,
      provenance: {
        ...generation,
        acceptedAt: "2026-07-16T11:00:00.000Z",
        approvingEditor: { displayName: "Editor", githubLogin: "editor", roleSnapshot: "EDITOR" },
        rightsStatement: "The editor confirms publication rights for this synthesis.",
        licenseSpdx: "CC-BY-4.0",
        checklistVersion: SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
        ordinal: 1,
        acceptedPredecessorVersionId: null,
        acceptedPredecessorOrdinal: null,
      },
      citations: [],
      version: { id: "version-1", ordinal: 1, isCurrent: true },
      freshness: {
        status: "unchecked",
        policyVersion: "synthesis-staleness/1.0.0",
        reasonCodes: [],
        affectedReferenceCount: 0,
      },
    };
    expect(publicSynthesisReviewSchema.safeParse(publicValue).success).toBe(true);
    for (const field of [
      "acceptedAt",
      "approvingEditor",
      "rightsStatement",
      "licenseSpdx",
      "checklistVersion",
      "ordinal",
      "acceptedPredecessorVersionId",
      "acceptedPredecessorOrdinal",
    ]) {
      const missing = structuredClone(publicValue) as typeof publicValue & {
        provenance: Record<string, unknown>;
      };
      delete missing.provenance[field];
      expect(publicSynthesisReviewSchema.safeParse(missing).success, field).toBe(false);
    }
  });

  it("fails closed for malformed or non-canonical regeneration proposal summaries", () => {
    const proposal = {
      id: "proposal-1",
      revision: 0,
      status: "open",
      reviewSlug: "synthesis-1",
      reviewTitle: "A grounded synthesis",
      acceptedReviewVersionId: "version-1",
      evaluationKey: hash,
      reasonCodes: ["node-head-changed"],
      affectedReferences: [{ kind: "node", id: "node-1", change: "changed" }],
      affectedReferenceCount: 1,
      affectedReferencesTruncated: false,
      createdAt: "2026-07-16T11:00:00.000Z",
    };
    expect(synthesisRegenerationProposalSchema.safeParse(proposal).success).toBe(true);
    expect(
      synthesisRegenerationProposalSchema.safeParse({
        ...proposal,
        reasonCodes: ["membership-added", "node-head-changed"],
      }).success,
    ).toBe(false);
    expect(
      synthesisRegenerationProposalSchema.safeParse({
        ...proposal,
        affectedReferenceCount: 2,
      }).success,
    ).toBe(false);
  });
});
