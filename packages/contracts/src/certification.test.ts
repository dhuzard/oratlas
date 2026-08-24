import { describe, expect, it } from "vitest";
import {
  certificationProtocolDefinitionSchema,
  createCertificationRunSchema,
  publicCertificationSummarySchema,
  submitCertificationResultSchema,
} from "./certification.js";

const criterion = {
  id: "generic-evidence",
  title: "Generic evidence review",
  description: "A protocol-owned criterion without domain-specific evaluator semantics.",
  required: true,
  allowedStatuses: ["pass", "concern", "fail", "insufficient-evidence"],
  evidenceRequired: true,
} as const;

describe("generic certification contracts", () => {
  it("keeps criterion, assessment, outcome, and completeness policy protocol-owned", () => {
    expect(
      certificationProtocolDefinitionSchema.parse({
        criteria: [criterion],
        assessmentModes: ["human", "ai", "hybrid"],
        outcomes: ["certified", "not-certified", "inconclusive"],
        requireCompleteSections: ["occurrences"],
      }),
    ).toMatchObject({ criteria: [{ id: "generic-evidence" }] });
  });

  it("rejects duplicate criterion definitions and result rows", () => {
    expect(() =>
      certificationProtocolDefinitionSchema.parse({
        criteria: [criterion, criterion],
        assessmentModes: ["human"],
        outcomes: ["inconclusive"],
      }),
    ).toThrow();
    expect(() =>
      submitCertificationResultSchema.parse({
        schemaVersion: "1.0.0",
        packetSha256: "a".repeat(64),
        criteria: [],
        outcome: "inconclusive",
        limitations: [],
        conflictOfInterest: { status: "not-provided" },
        independence: { declared: false, statement: "No independence assertion was made." },
        provenance: {},
      }),
    ).toThrow();
  });

  it("binds every run request to one exact publication version and protocol", () => {
    expect(
      createCertificationRunSchema.parse({
        publicationVersionId: "version-1",
        certificationProtocolId: "protocol-1",
        assessmentMode: "human",
        idempotencyKey: "external-run-001",
      }),
    ).toEqual(
      expect.objectContaining({
        publicationVersionId: "version-1",
        certificationProtocolId: "protocol-1",
      }),
    );
  });

  it("requires every public outcome to retain certifier and exact protocol attribution", () => {
    const summary = {
      id: "result-1",
      publicationVersionId: "version-1",
      certifier: { id: "certifier-1", slug: "institute-x", name: "Institute X" },
      protocol: {
        id: "protocol-1",
        seriesKey: "reproducibility",
        version: "2.0.0",
        sha256: "a".repeat(64),
        title: "Reproducibility",
      },
      outcome: "certified",
      assessmentMode: "human",
      issuedAt: "2026-08-24T12:00:00.000Z",
      lifecycle: [{ kind: "issued", reason: null, createdAt: "2026-08-24T12:00:00.000Z" }],
      href: "/api/certification-results/result-1",
    };
    expect(publicCertificationSummarySchema.parse(summary).protocol.version).toBe("2.0.0");
    expect(() =>
      publicCertificationSummarySchema.parse({ ...summary, certifier: undefined }),
    ).toThrow();
  });
});
