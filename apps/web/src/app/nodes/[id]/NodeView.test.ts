import { describe, expect, it } from "vitest";
import type { PublicNodeDetail } from "@oratlas/contracts";
import { nodeContextTrustAssessments, nodeEdgeTrustAssessments } from "./NodeView";

describe("NodeView legacy TRUST compatibility", () => {
  it("normalizes legacy edge and discussion singleton fields for rendering", () => {
    const edge = {
      trust: {
        assessmentId: "legacy-edge-assessment",
        protocolVersion: "TRUST-1.0",
        reviewStatus: "human-reviewed",
        verificationState: "platform-verified",
      },
    } as PublicNodeDetail["edges"][number];
    const context = {
      claimId: "claim-1",
      citationId: "citation-1",
      trust: {
        reviewStatus: "human-reviewed",
        verificationState: "platform-verified",
      },
    } as PublicNodeDetail["trustContext"][number];

    expect(nodeEdgeTrustAssessments(edge)).toEqual([
      expect.objectContaining({
        assessmentId: "legacy-edge-assessment",
        assessorType: "not supplied (legacy)",
      }),
    ]);
    expect(nodeContextTrustAssessments(context)).toEqual([
      expect.objectContaining({
        assessmentId: "legacy:claim-1:citation-1",
        protocolVersion: "not supplied (legacy)",
        assessorType: "not supplied (legacy)",
      }),
    ]);
  });
});
