import { describe, expect, it } from "vitest";
import {
  comparisonStudyArtifactSchema,
  summarizeComparisonStudy,
  type ComparisonStudyArtifact,
  type ComparisonStudySession,
} from "./comparison-study-evaluation.js";

const session = {
  participantId: "P01",
  role: "literature-synthesizer",
  newToOratlas: true,
  consentToStructuredObservation: true,
  tasks: [
    {
      taskId: "find-and-compare",
      outcome: "completed",
      elapsedSeconds: 120,
      helpRequests: 0,
      events: [
        {
          code: "comparison-opened",
          offsetSeconds: 20,
          side: "neither",
          result: "success",
        },
      ],
    },
    {
      taskId: "copy-and-reopen",
      outcome: "assisted",
      elapsedSeconds: 80,
      helpRequests: 1,
      events: [
        {
          code: "references-copied",
          offsetSeconds: 45,
          side: "neither",
          result: "success",
        },
      ],
    },
  ],
  interpretation: {
    understandsNoScientificConclusion: true,
    distinguishesSourceReuseFromIndependentSupport: false,
    treatsMissingContextAsUnknown: true,
  },
} satisfies ComparisonStudySession;

describe("comparison study artifact", () => {
  it("accepts a blank prepared template without treating it as a completed study", () => {
    const artifact: ComparisonStudyArtifact = {
      schemaVersion: "1.0.0",
      studyStatus: "prepared",
      sessions: [],
    };
    expect(comparisonStudyArtifactSchema.parse(artifact).sessions).toEqual([]);
    expect(summarizeComparisonStudy(artifact)).toMatchObject({
      studyStatus: "prepared",
      sessionsRecorded: 0,
      newToOratlas: 0,
      interpretation: { eligible: 0 },
    });
  });

  it("reports assigned task denominators and unaided completion without creating a threshold", () => {
    const artifact: ComparisonStudyArtifact = {
      schemaVersion: "1.0.0",
      studyStatus: "in-progress",
      sessions: [session],
    };
    const summary = summarizeComparisonStudy(artifact);
    expect(summary.tasks["find-and-compare"]).toEqual({
      assigned: 1,
      completedUnaided: 1,
      completedWithAssistance: 0,
      incomplete: 0,
      systemBlocked: 0,
      medianElapsedSeconds: 120,
    });
    expect(summary.tasks["copy-and-reopen"]).toMatchObject({
      assigned: 1,
      completedUnaided: 0,
      completedWithAssistance: 1,
      medianElapsedSeconds: 80,
    });
    expect(summary.interpretation).toEqual({
      eligible: 1,
      understandsNoScientificConclusion: 1,
      distinguishesSourceReuseFromIndependentSupport: 0,
      treatsMissingContextAsUnknown: 1,
    });
  });

  it("requires consent, pseudonyms, unique sessions and 5–8 records for complete status", () => {
    const base = {
      schemaVersion: "1.0.0",
      studyStatus: "in-progress",
      sessions: [session],
    };
    expect(comparisonStudyArtifactSchema.safeParse(base).success).toBe(true);
    expect(
      comparisonStudyArtifactSchema.safeParse({
        ...base,
        studyStatus: "complete",
      }).success,
    ).toBe(false);
    expect(
      comparisonStudyArtifactSchema.safeParse({
        ...base,
        sessions: [{ ...session, participantId: "participant-name" }],
      }).success,
    ).toBe(false);
    expect(
      comparisonStudyArtifactSchema.safeParse({
        ...base,
        sessions: [{ ...session, consentToStructuredObservation: false }],
      }).success,
    ).toBe(false);
  });

  it("keeps help counts consistent with completed and assisted outcomes", () => {
    for (const task of [
      { ...session.tasks[0], outcome: "completed", helpRequests: 1 },
      { ...session.tasks[0], outcome: "assisted", helpRequests: 0 },
    ]) {
      expect(
        comparisonStudyArtifactSchema.safeParse({
          schemaVersion: "1.0.0",
          studyStatus: "in-progress",
          sessions: [{ ...session, tasks: [task] }],
        }).success,
      ).toBe(false);
    }
  });

  it("rejects free text, URLs, record identifiers, and unrecognized event payload fields", () => {
    for (const extra of [
      { notes: "participant's scientific hypothesis" },
      { url: "https://example.test/compare?left=private-id" },
      { recordId: "private-id" },
    ]) {
      expect(
        comparisonStudyArtifactSchema.safeParse({
          schemaVersion: "1.0.0",
          studyStatus: "in-progress",
          sessions: [{ ...session, ...extra }],
        }).success,
      ).toBe(false);
    }
    const invalidEvent = {
      ...session,
      tasks: [
        {
          ...session.tasks[0],
          events: [{ ...session.tasks[0].events[0], sourceUrl: "https://example.test/private" }],
        },
      ],
    };
    expect(
      comparisonStudyArtifactSchema.safeParse({
        schemaVersion: "1.0.0",
        studyStatus: "in-progress",
        sessions: [invalidEvent],
      }).success,
    ).toBe(false);
  });
});
