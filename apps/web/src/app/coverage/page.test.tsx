import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const state = vi.hoisted(() => ({ getTopicCoverage: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/synthesis-coverage", () => ({
  getTopicCoverage: state.getTopicCoverage,
}));

import CoveragePage from "./page";

function coverageBounds(nodeLimitReached: boolean, synthesisCandidateLimitReached: boolean) {
  return {
    scannedNodeCount: 1_999,
    coveredNodeCount: 0,
    uncoveredNodeCount: 1_999,
    groups: [],
    topicStrategy:
      "Current public nodes are grouped by node kind and source repository; the node contract has no controlled topic taxonomy.",
    bounds: {
      nodeLimit: 2_000,
      scannedNodeCandidateCount: 2_000,
      nodeLimitReached,
      synthesisCandidateLimit: 500,
      synthesisCandidateLimitReached,
    },
  };
}

describe("/coverage server route", () => {
  beforeEach(() => state.getTopicCoverage.mockReset());

  it("renders both independent scan warnings when both bounds are active", async () => {
    state.getTopicCoverage.mockResolvedValue(coverageBounds(true, true));

    const html = renderToStaticMarkup(await CoveragePage());

    expect(html).toContain("the 2000-candidate node scan ceiling");
    expect(html).toContain("2000 stored candidates scanned; 1999 valid public heads included");
    expect(html).toContain("the 500-synthesis ceiling");
  });

  it.each([
    [true, false, "the 2000-candidate node scan ceiling", "the 500-synthesis ceiling"],
    [false, true, "the 500-synthesis ceiling", "the 2000-candidate node scan ceiling"],
  ])("retains single-bound wording", async (nodeBound, synthesisBound, shown, hidden) => {
    state.getTopicCoverage.mockResolvedValue(coverageBounds(nodeBound, synthesisBound));

    const html = renderToStaticMarkup(await CoveragePage());

    expect(html).toContain(shown);
    expect(html).not.toContain(hidden);
  });
});
