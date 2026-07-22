import { describe, expect, it } from "vitest";
import {
  canonicalizeNodeAlias,
  nodeAliasSchema,
  nodeIdentityCandidateSchema,
  nodeIdentityDecisionSchema,
} from "./node-identity.js";

describe("node identity contracts", () => {
  it("preserves DOI roles instead of conflating version and concept identifiers", () => {
    expect(
      nodeAliasSchema.parse({ scheme: "doi", role: "version-doi", value: "10.1000/work.v1" }),
    ).toMatchObject({ role: "version-doi", isExample: false });
    expect(
      nodeAliasSchema.parse({ scheme: "doi", role: "concept-doi", value: "10.1000/work" }),
    ).toMatchObject({ role: "concept-doi" });
  });

  it("rejects a scheme and role mismatch", () => {
    expect(
      nodeAliasSchema.safeParse({ scheme: "pmid", role: "version-doi", value: "123" }).success,
    ).toBe(false);
  });

  it("rejects malformed aliases and requires the reserved DOI prefix to be flagged", () => {
    expect(
      nodeAliasSchema.safeParse({
        scheme: "pmid",
        role: "work-pmid",
        value: "not-a-pmid",
      }).success,
    ).toBe(false);
    expect(
      nodeAliasSchema.safeParse({
        scheme: "doi",
        role: "work-doi",
        value: "10.5555/example",
        isExample: false,
      }).success,
    ).toBe(false);
  });

  it("returns canonical bare DOI, PMID, and OpenAlex values", () => {
    expect(
      canonicalizeNodeAlias({
        scheme: "doi",
        role: "work-doi",
        value: "https://doi.org/10.1000/WORK.X",
      }),
    ).toMatchObject({ value: "10.1000/work.x" });
    expect(
      canonicalizeNodeAlias({
        scheme: "pmid",
        role: "work-pmid",
        value: "PMID: 000123",
      }),
    ).toMatchObject({ value: "123" });
    expect(
      canonicalizeNodeAlias({
        scheme: "openalex",
        role: "work-openalex",
        value: "https://openalex.org/w987/",
      }),
    ).toMatchObject({ value: "W987" });
  });

  it("requires identity text only for claim candidates", () => {
    expect(
      nodeIdentityCandidateSchema.safeParse({
        knowledgeNodeId: "node-1",
        repositoryId: "repo-1",
        localNodeId: "claim-1",
        kind: "claim",
      }).success,
    ).toBe(false);
    expect(
      nodeIdentityCandidateSchema.safeParse({
        knowledgeNodeId: "node-2",
        repositoryId: "repo-1",
        localNodeId: "dataset-1",
        kind: "dataset",
        claim: { statement: "Not a claim payload", qualifiers: [] },
      }).success,
    ).toBe(false);
  });

  it("requires an attributable bounded editorial identity decision", () => {
    expect(
      nodeIdentityDecisionSchema.parse({
        decision: "confirm",
        expectedRevision: 0,
        note: "Editor compared the scientific scope.",
      }),
    ).toMatchObject({ decision: "confirm", expectedRevision: 0 });
    expect(
      nodeIdentityDecisionSchema.safeParse({
        decision: "merge",
        expectedRevision: 0,
        note: "Merge nodes automatically.",
      }).success,
    ).toBe(false);
  });
});
