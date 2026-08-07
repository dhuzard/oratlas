import { describe, expect, it } from "vitest";
import type { ReviewCommentList } from "@oratlas/contracts";
import { passageThreadsForPage, visiblePassageContributionCount } from "./passage-comments";

const base = {
  reviewVersionId: "version-1",
  kind: "comment" as const,
  body: "",
  author: null,
  createdAt: "2026-08-07T00:00:00.000Z",
};

describe("passage discussion summaries", () => {
  it("retains a removed anchored parent when it has a visible reply", () => {
    const comments: ReviewCommentList["comments"] = [
      {
        ...base,
        id: "removed-parent",
        status: "removed",
        anchor: {
          schemaVersion: "1.0.0",
          representation: "myst-rendered-text-v1",
          documentPath: "review.md",
          sourceSha256: "a".repeat(64),
          textQuote: { type: "TextQuoteSelector", exact: "result" },
          textPosition: { type: "TextPositionSelector", start: 0, end: 6 },
        },
        replies: [
          {
            ...base,
            id: "visible-reply",
            status: "visible",
            body: "The public reply remains visible.",
          },
        ],
      },
      {
        ...base,
        id: "removed-empty-thread",
        status: "removed",
        anchor: {
          schemaVersion: "1.0.0",
          representation: "myst-rendered-text-v1",
          documentPath: "review.md",
          sourceSha256: "a".repeat(64),
          textQuote: { type: "TextQuoteSelector", exact: "other" },
          textPosition: { type: "TextPositionSelector", start: 7, end: 12 },
        },
        replies: [],
      },
    ];

    const visibleThreads = passageThreadsForPage(comments, "review.md");
    expect(visibleThreads.map((comment) => comment.id)).toEqual(["removed-parent"]);
    expect(visiblePassageContributionCount(visibleThreads[0]!)).toBe(1);
  });
});
