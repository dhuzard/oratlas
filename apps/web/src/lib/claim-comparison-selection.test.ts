import { describe, expect, it } from "vitest";
import {
  parseClaimComparisonReference,
  readClaimComparisonSelection,
  withClaimComparisonSelection,
} from "./claim-comparison-selection";

const first = "/claims/exact-old-version/claim-a";
const second = "/api/publication-claim-occurrences/occurrence-b";

describe("bounded exact comparison selection in discovery URLs", () => {
  it("round-trips exact references without changing repeated filters or legacy review selection", () => {
    const href = withClaimComparisonSelection(
      "/compare?left=review-a&right=review-b&q=scope&interest=data&interest=code&known=a&known=b&focus=node&compareLeft=stale#coverage",
      { compareLeft: first, replaceSide: "first" },
    );
    const url = new URL(href, "https://oratlas.example");
    expect(url.pathname).toBe("/compare");
    expect(url.hash).toBe("#coverage");
    expect(url.searchParams.get("left")).toBe("review-a");
    expect(url.searchParams.get("right")).toBe("review-b");
    expect(url.searchParams.get("q")).toBe("scope");
    expect(url.searchParams.getAll("interest")).toEqual(["data", "code"]);
    expect(url.searchParams.getAll("known")).toEqual(["a", "b"]);
    expect(url.searchParams.get("focus")).toBe("node");
    expect(readClaimComparisonSelection(Object.fromEntries(url.searchParams))).toEqual({
      compareLeft: first,
      replaceSide: "first",
    });
  });

  it("clears only comparison selection including replacement direction", () => {
    const href = withClaimComparisonSelection(
      "/explore?q=scope&compareLeft=old&compareLeft=duplicate&replaceSide=first#map",
      {},
    );
    expect(href).toBe("/explore?q=scope#map");
  });

  it("does not choose one value from duplicate comparison parameters", () => {
    expect(readClaimComparisonSelection({ compareLeft: [first, second] })).toEqual({});
    expect(
      readClaimComparisonSelection({ compareLeft: first, replaceSide: ["first", "second"] }),
    ).toEqual({});
    expect(readClaimComparisonSelection({ compareLeft: first, replaceSide: "latest" })).toEqual({});
  });

  it("rejects unsupported, malformed, mutable and oversized paths without substituting a reference", () => {
    for (const reference of [
      "/nodes/claim",
      "https://example.test/claims/a/b",
      "/claims/a/b?latest=1",
      "/claims/a/%2f",
      "/claims/a/%00",
      "/claims/a/%zz",
      "/claims/a/b#section",
      `/claims/a/${"b".repeat(301)}`,
      `/claims/${"a".repeat(1601)}/b`,
    ]) {
      expect(parseClaimComparisonReference(reference)).toBeNull();
      expect(readClaimComparisonSelection({ compareLeft: reference })).toEqual({});
    }
  });

  it("accepts escaped exact identifiers and rejects nonlocal link destinations", () => {
    expect(parseClaimComparisonReference("/claims/version/claim%20one")).toEqual({
      kind: "review",
      versionId: "version",
      localClaimId: "claim one",
    });
    for (const href of [
      "https://example.test/",
      "//example.test/",
      "/\\example.test/",
      "/\nunsafe",
    ]) {
      expect(() => withClaimComparisonSelection(href, { compareLeft: first })).toThrow();
    }
  });
});
