import { describe, expect, it } from "vitest";
import {
  firstTimeExplorationStudySchema,
  summarizeFirstTimeExploration,
} from "./first-time-exploration-evaluation.js";

const completeSession = {
  participantId: "P01",
  centralPromise: {
    scientificClaim: true,
    linkedEvidence: true,
    independentAssessmentOrDisagreement: true,
    originalRecordPreserved: true,
  },
  reachedPersonalizedLandscape: true,
  distinguished: {
    review: true,
    claim: true,
    evidence: true,
    assessment: true,
    disagreement: true,
  },
  returnedToOverview: true,
  keyboardAttempt: { completed: true },
};

describe("first-time exploration evaluation", () => {
  it("summarizes observed sessions without inventing a threshold", () => {
    const summary = summarizeFirstTimeExploration({
      protocolVersion: "1.0.0",
      sessions: [
        completeSession,
        {
          ...completeSession,
          participantId: "P02",
          centralPromise: { ...completeSession.centralPromise, originalRecordPreserved: false },
          keyboardAttempt: undefined,
        },
      ],
    });

    expect(summary.completedSessions).toBe(2);
    expect(summary.outcomes.centralPromiseRecognized).toEqual({
      passed: 1,
      eligible: 2,
      rate: 0.5,
    });
    expect(summary.outcomes.keyboardJourneyCompleted).toEqual({
      passed: 1,
      eligible: 1,
      attempted: 1,
      rate: 1,
    });
  });

  it("rejects free-form notes and identifying participant labels", () => {
    expect(
      firstTimeExplorationStudySchema.safeParse({
        protocolVersion: "1.0.0",
        sessions: [{ ...completeSession, participantId: "Ada", notes: "identifying detail" }],
      }).success,
    ).toBe(false);
  });
});
