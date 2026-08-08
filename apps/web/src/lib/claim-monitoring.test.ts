import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { claimPassportLinks } from "./claim-monitoring";

describe("claim passport hypermedia links", () => {
  it("encodes relative review, claim, and exact graph transitions", () => {
    expect(
      claimPassportLinks("review / β", "version / 1", "claim / β", {
        nodeId: "node / β",
        nodeVersionId: "node-version / 1",
      }),
    ).toEqual({
      self: "/api/claims/version%20%2F%201/claim%20%2F%20%CE%B2",
      html: "/claims/version%20%2F%201/claim%20%2F%20%CE%B2",
      review: "/api/reviews/review%20%2F%20%CE%B2",
      reviewVersion: "/api/reviews/review%20%2F%20%CE%B2/versions/version%20%2F%201",
      graph:
        "/api/graph?seed=node%20%2F%20%CE%B2&version=node-version%20%2F%201&status=authoritative",
    });
  });

  it("omits graph navigation when the claim has no canonical graph identity", () => {
    expect(claimPassportLinks("review", "version", "claim")).toEqual({
      self: "/api/claims/version/claim",
      html: "/claims/version/claim",
      review: "/api/reviews/review",
      reviewVersion: "/api/reviews/review/versions/version",
      graph: undefined,
    });
  });
});
