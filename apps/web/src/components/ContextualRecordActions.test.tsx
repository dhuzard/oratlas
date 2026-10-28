import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextualRecordActions } from "./ContextualRecordActions.js";

describe("contextual record actions", () => {
  it("keeps historical review actions on the exact source version", () => {
    const html = renderToStaticMarkup(
      <ContextualRecordActions
        sourceType="review-version"
        sourceHref="/reviews/review-a/versions/historical-version"
        reference="/claims/historical-version/claim-a"
      />,
    );
    for (const fragment of ["community-review", "formal-challenges", "assessments"]) {
      expect(html).toContain(`/reviews/review-a/versions/historical-version#${fragment}`);
    }
    expect(html).toContain("discussion read-only");
    expect(html).not.toContain("commentOn=");
    expect(html).not.toContain('href="/editorial');
  });

  it("does not substitute legacy participation for an external occurrence", () => {
    const html = renderToStaticMarkup(
      <ContextualRecordActions
        sourceType="publication-version"
        sourceHref="/publications/p/versions/pv"
        reference="/api/publication-claim-occurrences/occurrence-a"
      />,
    );
    expect(html).toContain("has no comment or challenge form here");
    expect(html).toContain("/api/publication-claim-occurrences/occurrence-a");
    expect(html).toContain('href="/publications/p/versions/pv"');
    expect(html).not.toContain("#formal-challenges");
    expect(html).not.toContain("#community-review");
    expect(html).not.toContain("<form");
  });
});
