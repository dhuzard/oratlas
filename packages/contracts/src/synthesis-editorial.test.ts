import { describe, expect, it } from "vitest";
import {
  acceptedSynthesisProvenanceSchema,
  createPersistedSynthesisGenerationProvenanceSchema,
  editorialSynthesisDraftSchema,
  isSupportedSynthesisAcceptanceChecklist,
  publicSynthesisCitationSchema,
  publicSynthesisReviewSchema,
  synthesisRegenerationProposalSchema,
  publicSynthesisVersionBaseSchema,
  synthesisFreshnessBaseSchema,
  synthesisDraftDecisionSchema,
  SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
  SYNTHESIS_ACCEPTANCE_CHECKLIST_SCHEMAS,
  SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
  SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
  SYNTHESIS_PIPELINE_SOFTWARE_ID,
  SYNTHESIS_PIPELINE_SOFTWARE_NAME,
  SYNTHESIS_PUBLIC_AI_LABEL,
  SYNTHESIS_PUBLIC_CITATION_FIELDS,
  SYNTHESIS_PUBLIC_FRESHNESS_FIELDS,
  SYNTHESIS_PUBLIC_PRIVATE_FIELD_DENYLIST,
  SYNTHESIS_PUBLIC_PROVENANCE_FIELDS,
  SYNTHESIS_PUBLIC_REVIEW_FIELDS,
  SYNTHESIS_PUBLIC_SCOPE_NOTICE,
  SYNTHESIS_PUBLIC_VERSION_FIELDS,
  SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS,
  SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS,
  SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS,
  synthesisAcceptanceChecklistSchema,
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

function publicReview() {
  return {
    slug: "synthesis-1",
    reviewType: "ai-synthesis" as const,
    title: document.title,
    abstract: document.summary,
    document,
    provenance: {
      ...generation,
      acceptedAt: "2026-07-16T11:00:00.000Z",
      approvingEditor: {
        displayName: "Editor",
        githubLogin: "editor",
        roleSnapshot: "EDITOR" as const,
      },
      rightsStatement: "The editor confirms publication rights for this synthesis.",
      licenseSpdx: "CC-BY-4.0",
      checklistVersion: SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
      acceptedPredecessorVersionId: null,
      acceptedPredecessorOrdinal: null,
      ordinal: 1,
    },
    citations: [],
    version: { id: "version-1", ordinal: 1, isCurrent: true },
    freshness: {
      status: "unchecked" as const,
      policyVersion: "synthesis-staleness/1.0.0" as const,
      reasonCodes: [],
      affectedReferenceCount: 0,
    },
  };
}

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
    expect(
      synthesisDraftDecisionSchema.safeParse({ ...decision, licenseSpdx: "not-a-license" }).success,
    ).toBe(false);
    expect(
      synthesisDraftDecisionSchema.safeParse({
        ...decision,
        licenseSpdx: "(MIT OR Apache-2.0) AND GPL-3.0-only WITH Classpath-exception-2.0",
      }).success,
    ).toBe(true);
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
    const publicValue = publicReview();
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
      affectedReferences: [
        {
          kind: "node",
          id: "node-1",
          change: "changed",
          previousVersionId: "node-1-v1",
          currentVersionId: "node-1-v2",
        },
      ],
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

  it("pins public terminology, allowlists, private denials, and append-only policy registries", () => {
    const publicValue = publicReview();
    expect(Object.keys(publicValue)).toEqual(SYNTHESIS_PUBLIC_REVIEW_FIELDS);
    expect(Object.keys(publicValue.provenance)).toEqual(SYNTHESIS_PUBLIC_PROVENANCE_FIELDS);
    expect(Object.keys(publicSynthesisReviewSchema.shape)).toEqual(SYNTHESIS_PUBLIC_REVIEW_FIELDS);
    expect(Object.keys(acceptedSynthesisProvenanceSchema.shape)).toEqual(
      SYNTHESIS_PUBLIC_PROVENANCE_FIELDS,
    );
    expect(Object.keys(publicSynthesisCitationSchema.shape)).toEqual(
      SYNTHESIS_PUBLIC_CITATION_FIELDS,
    );
    expect(Object.keys(publicSynthesisVersionBaseSchema.shape)).toEqual(
      SYNTHESIS_PUBLIC_VERSION_FIELDS,
    );
    expect(Object.keys(synthesisFreshnessBaseSchema.shape)).toEqual(
      SYNTHESIS_PUBLIC_FRESHNESS_FIELDS,
    );
    expect(SYNTHESIS_PUBLIC_AI_LABEL).toBe("AI-generated synthesis — editor-accepted");
    expect(SYNTHESIS_PUBLIC_SCOPE_NOTICE).toContain("does not establish peer review");
    expect(SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS).toContain(
      SYNTHESIS_ATTRIBUTION_POLICY_VERSION,
    );
    expect(SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS).toContain(
      SYNTHESIS_MATERIALIZATION_POLICY_VERSION,
    );
    expect(SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS).toContain(
      SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION,
    );
    expect(SYNTHESIS_SUPPORTED_ATTRIBUTION_POLICY_VERSIONS).toContain(
      "synthesis-attribution/1.0.0",
    );
    expect(SYNTHESIS_SUPPORTED_MATERIALIZATION_POLICY_VERSIONS).toContain(
      "synthesis-materialization/1.0.0",
    );
    expect(SYNTHESIS_SUPPORTED_ACCEPTANCE_CHECKLIST_VERSIONS).toContain(
      "synthesis-checklist/1.0.0",
    );
    expect(Object.keys(SYNTHESIS_ACCEPTANCE_CHECKLIST_SCHEMAS)).toEqual([
      "synthesis-checklist/1.0.0",
    ]);
    expect(SYNTHESIS_ACCEPTANCE_CHECKLIST_SCHEMAS["synthesis-checklist/1.0.0"]).toBe(
      synthesisAcceptanceChecklistSchema,
    );
    expect(
      isSupportedSynthesisAcceptanceChecklist(SYNTHESIS_ACCEPTANCE_CHECKLIST_VERSION, {
        groundingAndCitationsReviewed: true,
        contradictionAndNonConsensusFramingReviewed: true,
        attributionAndAiDisclosureReviewed: true,
        limitationsReviewed: true,
        privacyAndInjectionLeakageReviewed: true,
        rightsAndLicenseConfirmed: true,
      }),
    ).toBe(true);
    expect(isSupportedSynthesisAcceptanceChecklist("synthesis-checklist/999.0.0", {})).toBe(false);

    // This literal historical dispatch must remain valid even after CURRENT advances to a newer key.
    expect(
      isSupportedSynthesisAcceptanceChecklist("synthesis-checklist/1.0.0", {
        groundingAndCitationsReviewed: true,
        contradictionAndNonConsensusFramingReviewed: true,
        attributionAndAiDisclosureReviewed: true,
        limitationsReviewed: true,
        privacyAndInjectionLeakageReviewed: true,
        rightsAndLicenseConfirmed: true,
      }),
    ).toBe(true);

    for (const field of SYNTHESIS_PUBLIC_PRIVATE_FIELD_DENYLIST) {
      expect(
        publicSynthesisReviewSchema.safeParse({ ...publicValue, [field]: "private-value" }).success,
        field,
      ).toBe(false);
    }
  });

  it("keeps persisted provenance readable across a simulated supported-version bump", () => {
    const simulated = createPersistedSynthesisGenerationProvenanceSchema(
      ["synthesis-attribution/1.0.0", "synthesis-attribution/2.0.0"],
      ["synthesis-materialization/1.0.0", "synthesis-materialization/2.0.0"],
    );
    expect(simulated.safeParse(generation).success).toBe(true);
    expect(
      simulated.safeParse({
        ...generation,
        attributionPolicyVersion: "synthesis-attribution/2.0.0",
        materializationPolicyVersion: "synthesis-materialization/2.0.0",
      }).success,
    ).toBe(true);
    expect(
      synthesisDraftDecisionSchema.safeParse({
        action: "accept",
        expectedRevision: 0,
        idempotencyKey: "invalid-spdx-0001",
        rationale: "The editor completed all required checks for publication.",
        licenseSpdx: "not-a-license",
        rightsStatement: "The editor confirms publication rights for this synthesis.",
        checklist: {
          groundingAndCitationsReviewed: true,
          contradictionAndNonConsensusFramingReviewed: true,
          attributionAndAiDisclosureReviewed: true,
          limitationsReviewed: true,
          privacyAndInjectionLeakageReviewed: true,
          rightsAndLicenseConfirmed: true,
        },
      }).success,
    ).toBe(false);
  });

  it("fails public reads closed for invalid SPDX expressions and corrupt DOI pairs", () => {
    const value = publicReview();
    expect(
      publicSynthesisReviewSchema.safeParse({
        ...value,
        provenance: { ...value.provenance, licenseSpdx: "not-a-license" },
      }).success,
    ).toBe(false);
    expect(
      publicSynthesisReviewSchema.safeParse({
        ...value,
        version: { ...value.version, versionDoi: "10.5555/example.v1" },
      }).success,
    ).toBe(false);
    expect(
      publicSynthesisReviewSchema.safeParse({
        ...value,
        version: {
          ...value.version,
          versionDoi: "10.5281/zenodo.1",
          conceptDoi: "10.5281/ZENODO.1",
        },
      }).success,
    ).toBe(false);
  });
});
