import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { reviewClaimLinks, reviewDetailLinks } from "./reviews";

describe("review hypermedia links", () => {
  it("distinguishes current and exact representations with encoded relative paths", () => {
    expect(reviewDetailLinks("review / β", "version / 1", false)).toEqual({
      self: "/api/reviews/review%20%2F%20%CE%B2",
      html: "/reviews/review%20%2F%20%CE%B2",
      exactVersion: "/api/reviews/review%20%2F%20%CE%B2/versions/version%20%2F%201",
    });
    expect(reviewDetailLinks("review / β", "version / 1", true)).toEqual({
      self: "/api/reviews/review%20%2F%20%CE%B2/versions/version%20%2F%201",
      html: "/reviews/review%20%2F%20%CE%B2/versions/version%20%2F%201",
      exactVersion: "/api/reviews/review%20%2F%20%CE%B2/versions/version%20%2F%201",
    });
  });

  it("links each immutable claim to matching machine and human records", () => {
    expect(reviewClaimLinks("version / 1", "claim / β")).toEqual({
      self: "/api/claims/version%20%2F%201/claim%20%2F%20%CE%B2",
      html: "/claims/version%20%2F%201/claim%20%2F%20%CE%B2",
    });
  });
});
