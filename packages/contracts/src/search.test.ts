import { describe, expect, it } from "vitest";
import { archiveSearchQuerySchema, archiveSearchResponseSchema } from "./index.js";

describe("archive search contracts", () => {
  it("distinguishes accepted AI syntheses from repository reviews and nodes", () => {
    expect(archiveSearchQuerySchema.parse({ contentType: "synthesis" })).toMatchObject({
      contentType: "synthesis",
      page: 1,
      pageSize: 20,
    });
    expect(
      archiveSearchResponseSchema.parse({
        total: 1,
        page: 1,
        pageSize: 20,
        synthesisCandidateScan: { limit: 500, limitReached: false },
        items: [
          {
            contentType: "synthesis",
            slug: "accepted-synthesis",
            title: "Accepted synthesis",
            abstract: "An editor-accepted synthesis of the public graph.",
            version: { id: "version-1", ordinal: 1, isCurrent: true },
            freshness: { status: "stale", affectedReferenceCount: 3 },
            score: 0,
            sortDate: "2026-07-17T12:00:00.000Z",
          },
        ],
      }).items[0],
    ).toMatchObject({
      contentType: "synthesis",
      freshness: { status: "stale", affectedReferenceCount: 3 },
    });
  });

  it("rejects incomplete or over-disclosed synthesis summaries", () => {
    const base = {
      total: 1,
      page: 1,
      pageSize: 20,
      synthesisCandidateScan: { limit: 500, limitReached: false },
      items: [
        {
          contentType: "synthesis",
          slug: "accepted-synthesis",
          title: "Accepted synthesis",
          abstract: "An editor-accepted synthesis of the public graph.",
          version: { id: "version-1", ordinal: 1, isCurrent: true },
          freshness: { status: "fresh", affectedReferenceCount: 0 },
          score: 0,
          sortDate: "2026-07-17T12:00:00.000Z",
        },
      ],
    };
    const synthesisItem = base.items[0]!;
    expect(
      archiveSearchResponseSchema.safeParse({
        ...base,
        items: [{ ...synthesisItem, freshness: { status: "stale" } }],
      }).success,
    ).toBe(false);
    expect(
      archiveSearchResponseSchema.safeParse({
        ...base,
        items: [{ ...synthesisItem, privateDraftId: "must-not-leak" }],
      }).success,
    ).toBe(false);
    expect(
      archiveSearchResponseSchema.safeParse({
        ...base,
        items: [
          {
            ...synthesisItem,
            version: {
              ...synthesisItem.version,
              versionDoi: "10.5555/private-example",
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      archiveSearchResponseSchema.safeParse({
        ...base,
        items: [
          {
            ...synthesisItem,
            version: {
              ...synthesisItem.version,
              versionDoi: "10.5281/zenodo.1234567",
              conceptDoi: "10.5281/zenodo.1234567",
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
