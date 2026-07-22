import { describe, expect, it } from "vitest";
import { docmap, type DocmapInput } from "./docmap.js";

const base: DocmapInput = {
  platformVersion: "0.1.0",
  id: "https://atlas.example.org/reviews/r/versions/v-1/export/docmap",
  publisherName: "Open Review Atlas",
  publisherUrl: "https://atlas.example.org",
  versionUrl: "https://atlas.example.org/reviews/r/versions/v-1",
  versionDoi: "10.5281/zenodo.123456",
  isExample: false,
  created: "2026-07-01T00:00:00.000Z",
  updated: "2026-07-10T00:00:00.000Z",
  submission: { submittedAt: "2026-07-01T00:00:00.000Z", submitterLogin: "author-a" },
  rounds: [
    {
      roundNumber: 1,
      openedAt: "2026-07-02T00:00:00.000Z",
      reports: [
        {
          reviewerLogin: "rev-1",
          reviewerOrcid: "0000-0002-1825-0097",
          orcidVerified: true,
          recommendation: "major-revision",
          submittedAt: "2026-07-03T00:00:00.000Z",
        },
        {
          reviewerLogin: "rev-2",
          reviewerOrcid: "0000-0000-0000-0001",
          orcidVerified: false,
          recommendation: "minor-revision",
          submittedAt: "2026-07-04T00:00:00.000Z",
        },
      ],
      responses: [{ authorLogin: "author-a", submittedAt: "2026-07-05T00:00:00.000Z" }],
      decision: {
        editorLogin: "editor-e",
        decision: "request-changes",
        issuedAt: "2026-07-06T00:00:00.000Z",
      },
    },
  ],
  publishedAt: "2026-07-10T00:00:00.000Z",
};

describe("docmap", () => {
  it("chains submission → round → publication steps", () => {
    const map = docmap(base);
    const steps = map["steps"] as Record<string, Record<string, unknown>>;
    expect(map["first-step"]).toBe("_:b0");
    expect(map["publisher"]).toMatchObject({ "platform-version": "0.1.0" });
    expect(steps["_:b0"]!["next-step"]).toBe("_:b1");
    expect(steps["_:b1"]!["previous-step"]).toBe("_:b0");
    expect(steps["_:b1"]!["next-step"]).toBe("_:b2");
    expect(Object.keys(steps)).toHaveLength(3);
    const assertion = (steps["_:b2"]!["assertions"] as Array<{ status: string }>)[0]!;
    expect(assertion.status).toBe("published");
  });

  it("emits verified reviewer ORCIDs only", () => {
    const serialized = JSON.stringify(docmap(base));
    expect(serialized).toContain("https://orcid.org/0000-0002-1825-0097");
    expect(serialized).not.toContain("0000-0000-0000-0001");
  });

  it("withholds example DOIs from expressions", () => {
    const serialized = JSON.stringify(
      docmap({ ...base, isExample: true, versionDoi: "10.5555/zenodo.1" }),
    );
    expect(serialized).not.toContain("10.5555");
  });

  it("marks undecided rounds as under-review", () => {
    const map = docmap({
      ...base,
      publishedAt: undefined,
      rounds: [{ ...base.rounds[0]!, decision: undefined }],
    });
    const steps = map["steps"] as Record<string, Record<string, unknown>>;
    const assertion = (steps["_:b1"]!["assertions"] as Array<{ status: string }>)[0]!;
    expect(assertion.status).toBe("under-review");
    expect(steps["_:b1"]!["next-step"]).toBeUndefined();
  });
});
