import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@oratlas/config", () => ({ getServerEnv: () => ({ llmEnabled: false }) }));
vi.mock("./db", () => ({ prisma: {} }));

import { discussionReferences } from "./discuss";

describe("discussionReferences", () => {
  it("uses exact rendered canonical version ids for Explore grounding highlights", () => {
    const references = discussionReferences(
      {
        claims: [
          {
            claimId: "global-claim-1",
            reviewVersionId: "review-version-1",
            localClaimId: "claim-1",
            text: "Selected claim",
            relations: [{ citationId: "global-citation-1" }],
          },
        ],
        citations: [
          {
            citationId: "global-citation-1",
            localCitationId: "citation-1",
            workId: "work-1",
            title: "Selected work",
          },
        ],
      } as never,
      {
        kind: "explore",
        claimIds: ["global-claim-1"],
        landscapeNodeIds: [
          "graph:stable-claim:exact-claim-version",
          "graph:stable-work:exact-work-version",
        ],
        landscapeNodeVersionIds: ["exact-claim-version", "exact-work-version"],
        landscapeEdgeIds: ["edge-1"],
        claimLandscapeNodeIds: {
          "global-claim-1": "graph:stable-claim:exact-claim-version",
        },
        citationLandscapeNodeIds: {
          "global-citation-1": "graph:stable-work:exact-work-version",
        },
        label: "Selected path",
      },
    );

    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "global-claim-1",
          landscapeNodeId: "graph:stable-claim:exact-claim-version",
        }),
        expect.objectContaining({
          id: "global-citation-1",
          landscapeNodeId: "graph:stable-work:exact-work-version",
        }),
      ]),
    );
    expect(references.some((reference) => reference.landscapeNodeId.startsWith("claim:"))).toBe(
      false,
    );
    expect(references.some((reference) => reference.landscapeNodeId.startsWith("evidence:"))).toBe(
      false,
    );
  });
});
