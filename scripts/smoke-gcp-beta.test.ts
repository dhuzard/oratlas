import { describe, expect, it } from "vitest";
import { knowledgeRecommendationResponseSchema } from "../packages/contracts/src/knowledge-recommendation.js";
// The deployment smoke is intentionally dependency-free JavaScript so the production image can run it.
// @ts-expect-error The .mjs smoke script does not publish a TypeScript declaration file.
import { parseArguments, runBetaSmoke } from "./smoke-gcp-beta.mjs";

describe("GCP beta smoke", () => {
  it("checks the complete personalized graph journey", async () => {
    const requested: string[] = [];
    const request = async (input: string) => {
      requested.push(input);
      const url = new URL(input);
      if (url.pathname === "/api/health/ready") {
        return Response.json({ status: "ready", checks: { database: "ok" } });
      }
      if (url.pathname === "/") {
        return new Response(
          "Scientific publications that can be independently checked. Evidence is attached without altering the original publication.",
        );
      }
      if (url.pathname === "/explore") {
        return new Response("Show my knowledge path · Nodes worth exploring for this interest");
      }
      if (url.pathname === "/api/landscape") {
        const recommendationResponse = {
          schemaVersion: "2.0.0",
          algorithm: {
            id: "explicit-interest-recommendation",
            version: "2.0.0",
            purpose: "recommendation",
            limitations: [
              "not-a-truth-score",
              "not-a-quality-score",
              "canonical-source-assertion-and-confirmed-edges",
              "bounded-to-three-entry-neighborhoods-and-twelve-exact-versions",
            ],
          },
          query: {
            q: "replay",
            interests: ["data-code"],
            knownNodeIds: [],
          },
          recommendations: [
            {
              nodeId: "node-1",
              nodeVersionId: "version-1",
              rank: 1,
              score: 1,
              reasons: ["x"],
              anchors: [],
            },
          ],
          omittedUnboundCount: 0,
        };
        expect(knowledgeRecommendationResponseSchema.parse(recommendationResponse)).toEqual(
          recommendationResponse,
        );
        return Response.json(recommendationResponse);
      }
      if (url.pathname === "/api/graph") {
        return Response.json({
          nodes: [{ nodeId: "node-1", nodeVersionId: "version-1" }],
        });
      }
      return new Response("ok");
    };

    const result = await runBetaSmoke(
      parseArguments(["https://oratlas.example/", "--query", "replay", "--interest", "data-code"]),
      request,
    );

    expect(result).toMatchObject({
      status: "ok",
      recommendationCount: 1,
      omittedUnboundCount: 0,
      checkedNodeId: "node-1",
    });
    expect(requested).toContain(
      "https://oratlas.example/api/landscape?q=replay&interest=data-code",
    );
    expect(requested).toContain(
      "https://oratlas.example/api/graph?seed=node-1&version=version-1&limit=1",
    );
    expect(requested).toContain(
      "https://oratlas.example/graph/occurrences/node-1/versions/version-1",
    );
    expect(requested).toContain("https://oratlas.example/graph?seed=node-1");
  });

  it("requires an explicit query and interest fixture", () => {
    expect(() => parseArguments(["https://oratlas.example"])).toThrow("--query is required");
  });
});
