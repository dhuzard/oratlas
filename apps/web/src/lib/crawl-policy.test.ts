import { describe, expect, it } from "vitest";
import { EXPLORE_QUERY_DISALLOW, exploreRobots } from "./crawl-policy";

describe("explore crawl policy", () => {
  it("keeps the bare explore page indexable", () => {
    expect(exploreRobots({})).toBeUndefined();
  });

  it("marks parameterised graph views noindex and nofollow", () => {
    expect(
      exploreRobots({ reviewSlug: "a-review", known: ["node-a", "node-b"], focus: "node-c" }),
    ).toEqual({ index: false, follow: false });
    expect(exploreRobots({ q: "" })).toEqual({ index: false, follow: false });
  });

  it("ignores absent parameter values", () => {
    expect(exploreRobots({ known: [], focus: undefined })).toBeUndefined();
  });

  it("disallows every query-string variant of explore", () => {
    expect(EXPLORE_QUERY_DISALLOW).toBe("/explore?");
  });
});
