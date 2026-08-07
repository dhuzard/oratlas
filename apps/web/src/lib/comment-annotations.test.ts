import { describe, expect, it } from "vitest";
import type { ReviewCommentList } from "@oratlas/contracts";
import { buildCommentAnnotationPage } from "./comment-annotations";

describe("buildCommentAnnotationPage", () => {
  it("exports passage comments and inherited reply targets as Web Annotations", () => {
    const anchor = {
      schemaVersion: "1.0.0" as const,
      representation: "myst-rendered-text-v1" as const,
      documentPath: "results.md",
      sourceSha256: "a".repeat(64),
      textQuote: { type: "TextQuoteSelector" as const, exact: "A stable result" },
      textPosition: { type: "TextPositionSelector" as const, start: 12, end: 27 },
    };
    const comments: ReviewCommentList = {
      reviewSlug: "review-one",
      reviewVersionId: "version-1",
      commentCount: 2,
      comments: [
        {
          id: "comment-1",
          reviewVersionId: "version-1",
          kind: "question",
          status: "visible",
          body: "How stable?",
          author: { githubLogin: "reader", displayName: "Reader", role: "USER" },
          anchor,
          createdAt: "2026-08-07T10:00:00.000Z",
          replies: [
            {
              id: "reply-1",
              reviewVersionId: "version-1",
              kind: "comment",
              status: "visible",
              body: "Across all seeds.",
              author: { githubLogin: "author", displayName: null, role: "USER" },
              createdAt: "2026-08-07T11:00:00.000Z",
            },
          ],
        },
      ],
    };

    const page = buildCommentAnnotationPage(
      "https://example.org/api/reviews/review-one/versions/version-1/annotations",
      comments,
    ) as { type: string; items: Array<Record<string, unknown>> };
    expect(page.type).toBe("AnnotationPage");
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.target).toMatchObject({
      "oratlas:documentPath": "results.md",
      selector: [
        expect.objectContaining({ type: "TextQuoteSelector", exact: "A stable result" }),
        expect.objectContaining({ type: "TextPositionSelector", start: 12 }),
      ],
    });
    expect(page.items[1]?.target).toEqual(page.items[0]?.target);
  });

  it("never exports a removed parent body", () => {
    const comments: ReviewCommentList = {
      reviewSlug: "review-one",
      reviewVersionId: "version-1",
      commentCount: 1,
      comments: [
        {
          id: "removed",
          reviewVersionId: "version-1",
          kind: "comment",
          status: "removed",
          body: "",
          author: null,
          createdAt: "2026-08-07T10:00:00.000Z",
          replies: [
            {
              id: "reply",
              reviewVersionId: "version-1",
              kind: "comment",
              status: "visible",
              body: "Visible reply",
              author: { githubLogin: "reader", displayName: null, role: "USER" },
              createdAt: "2026-08-07T11:00:00.000Z",
            },
          ],
        },
      ],
    };
    const page = buildCommentAnnotationPage("https://example.org/annotations", comments) as {
      items: Array<{ body: { value: string } }>;
    };
    expect(page.items.map((item) => item.body.value)).toEqual(["Visible reply"]);
  });
});
