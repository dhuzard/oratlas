import { describe, expect, it } from "vitest";
import type { NodeIdentityCandidate } from "@oratlas/contracts";
import {
  canonicalNodeAlias,
  normalizeClaimIdentity,
  proposeNodeIdentities,
} from "./node-identity.js";

const claim = (
  knowledgeNodeId: string,
  repositoryId: string,
  statement: string,
  overrides: Partial<NodeIdentityCandidate> = {},
): NodeIdentityCandidate => ({
  knowledgeNodeId,
  repositoryId,
  localNodeId: knowledgeNodeId,
  kind: "claim",
  aliases: [],
  claim: { statement, qualifiers: [] },
  ...overrides,
});

describe("node identity proposals", () => {
  it("treats DOI representations as the same work while preserving the stable nodes", () => {
    const input = [
      claim("node-a", "repo-a", "Treatment A changes outcome B.", {
        aliases: [
          {
            scheme: "doi",
            role: "work-doi",
            value: "https://doi.org/10.1000/WORK.X",
            isExample: false,
          },
        ],
      }),
      claim("node-b", "repo-b", "A distinct result is reported.", {
        aliases: [
          {
            scheme: "doi",
            role: "concept-doi",
            value: "10.1000/work.x",
            isExample: false,
          },
        ],
      }),
    ];
    const before = structuredClone(input);
    const report = proposeNodeIdentities(input);

    expect(report.proposals).toEqual([
      expect.objectContaining({
        kind: "same-work",
        sharedAliases: [
          {
            scheme: "doi",
            value: "10.1000/work.x",
            sourceRoles: ["work-doi"],
            targetRoles: ["concept-doi"],
          },
        ],
        signals: ["shared-identifier"],
      }),
    ]);
    expect(input).toEqual(before);
  });

  it("proposes near-identical claims after case, punctuation, and Unicode normalization", () => {
    const report = proposeNodeIdentities([
      claim("node-a", "repo-a", "Café treatment reduces mortality in 20 participants.", {
        claim: {
          statement: "Café treatment reduces mortality in 20 participants.",
          qualifiers: ["Adults only"],
        },
      }),
      claim("node-b", "repo-b", "CAFE treatment reduces mortality in 20 participants!", {
        claim: {
          statement: "CAFE treatment reduces mortality in 20 participants!",
          qualifiers: ["Adults only."],
        },
      }),
    ]);
    expect(report.proposals).toHaveLength(1);
    expect(report.proposals[0]).toMatchObject({
      kind: "same-claim",
      signals: ["normalized-text-hash"],
      textSimilarity: 1,
    });
  });

  it("uses conservative lexical similarity for near-identical non-equal claim text", () => {
    const report = proposeNodeIdentities([
      claim(
        "node-a",
        "repo-a",
        "Daily treatment significantly improves overall survival among adults with stage 2 disease after 12 months.",
      ),
      claim(
        "node-b",
        "repo-b",
        "Daily treatment significantly improves overall survival consistently among adults with stage 2 disease after 12 months.",
      ),
    ]);
    expect(report.proposals).toHaveLength(1);
    expect(report.proposals[0]).toMatchObject({
      kind: "same-claim",
      signals: ["normalized-text-similarity"],
    });
    expect(report.proposals[0]!.textSimilarity).toBeGreaterThanOrEqual(0.92);
  });

  it("canonicalizes PMID and OpenAlex aliases without losing their declared roles", () => {
    expect(
      canonicalNodeAlias({
        scheme: "pmid",
        role: "work-pmid",
        value: "PMID: 000123",
        isExample: false,
      }),
    ).toBe("pmid:123");
    expect(
      canonicalNodeAlias({
        scheme: "openalex",
        role: "work-openalex",
        value: "https://openalex.org/w987/",
        isExample: false,
      }),
    ).toBe("openalex:W987");
  });

  it("fails closed when runtime callers bypass TypeScript with an invalid alias shape", () => {
    expect(
      canonicalNodeAlias({
        scheme: "arxiv",
        role: "work-openalex",
        value: "W987",
        isExample: false,
      }),
    ).toBeUndefined();
    expect(
      canonicalNodeAlias({
        scheme: "doi",
        role: "work-openalex",
        value: "10.1000/work",
        isExample: false,
      }),
    ).toBeUndefined();
    expect(
      canonicalNodeAlias({
        scheme: "doi",
        role: "work-doi",
        value: "10.5555/example",
        isExample: false,
      }),
    ).toBeUndefined();
  });

  it("retains negation, numbers, and qualifiers so materially distinct claims stay distinct", () => {
    const positive = normalizeClaimIdentity("Treatment improves survival in 20 participants.", [
      "Adults only",
    ]);
    const negated = normalizeClaimIdentity(
      "Treatment does not improve survival in 20 participants.",
      ["Adults only"],
    );
    const changedNumber = normalizeClaimIdentity(
      "Treatment improves survival in 21 participants.",
      ["Adults only"],
    );
    const changedQualifier = normalizeClaimIdentity(
      "Treatment improves survival in 20 participants.",
      ["Children only"],
    );
    expect(
      new Set([positive.sha256, negated.sha256, changedNumber.sha256, changedQualifier.sha256])
        .size,
    ).toBe(4);

    const report = proposeNodeIdentities([
      claim("positive", "repo-a", "Treatment improves survival in 20 participants."),
      claim("negated", "repo-b", "Treatment does not improve survival in 20 participants."),
      claim("number", "repo-c", "Treatment improves survival in 21 participants."),
    ]);
    expect(report.proposals).toEqual([]);
  });

  it("protects cannot and common n't forms from high-overlap same-claim proposals", () => {
    expect(normalizeClaimIdentity("The model cannot predict outcomes.").sha256).toBe(
      normalizeClaimIdentity("The model can not predict outcomes.").sha256,
    );
    expect(normalizeClaimIdentity("The model can't predict outcomes.").sha256).toBe(
      normalizeClaimIdentity("The model can not predict outcomes.").sha256,
    );
    expect(normalizeClaimIdentity("The model can’t predict outcomes.").sha256).toBe(
      normalizeClaimIdentity("The model can not predict outcomes.").sha256,
    );

    const longCan =
      "The calibrated model can reliably predict treatment outcomes among adults across all twelve participating clinical research centers.";
    for (const longCannot of [
      "The calibrated model cannot reliably predict treatment outcomes among adults across all twelve participating clinical research centers.",
      "The calibrated model can't reliably predict treatment outcomes among adults across all twelve participating clinical research centers.",
      "The calibrated model can’t reliably predict treatment outcomes among adults across all twelve participating clinical research centers.",
    ]) {
      expect(
        proposeNodeIdentities([
          claim("positive", "repo-a", longCan),
          claim("negative", "repo-b", longCannot),
        ]).proposals,
      ).toEqual([]);
    }

    expect(
      proposeNodeIdentities([
        claim(
          "does",
          "repo-a",
          "The calibrated model does reliably predict treatment outcomes among adults across all twelve participating clinical research centers.",
        ),
        claim(
          "does-not",
          "repo-b",
          "The calibrated model doesn't reliably predict treatment outcomes among adults across all twelve participating clinical research centers.",
        ),
      ]).proposals,
    ).toEqual([]);
  });

  it.each([
    ["population", "Adults only", "Children only"],
    ["scope", "Hospital settings", "Community settings"],
    ["negated qualifier", "Includes prior treatment", "Does not include prior treatment"],
  ])("fails closed on contradictory %s semantics", (_case, leftQualifier, rightQualifier) => {
    const statement =
      "Daily treatment significantly improves overall survival among participants with stage 2 disease after twelve months of follow-up.";
    const report = proposeNodeIdentities([
      claim("node-a", "repo-a", statement, {
        claim: { statement, qualifiers: [leftQualifier] },
      }),
      claim("node-b", "repo-b", statement, {
        claim: { statement, qualifiers: [rightQualifier] },
      }),
    ]);
    expect(report.proposals).toEqual([]);
  });

  it("never lets example aliases drive a proposal", () => {
    const report = proposeNodeIdentities([
      claim("node-a", "repo-a", "First unrelated claim.", {
        aliases: [
          { scheme: "doi", role: "version-doi", value: "10.5555/example", isExample: true },
        ],
      }),
      claim("node-b", "repo-b", "Second unrelated claim.", {
        aliases: [
          { scheme: "doi", role: "version-doi", value: "10.5555/example", isExample: true },
        ],
      }),
    ]);
    expect(report.proposals).toEqual([]);
  });

  it("does not compare different node kinds or nodes inside one repository", () => {
    const shared = {
      scheme: "pmid" as const,
      role: "work-pmid" as const,
      value: "000123",
      isExample: false,
    };
    const report = proposeNodeIdentities([
      claim("claim-a", "repo-a", "The same statement", { aliases: [shared] }),
      claim("claim-b", "repo-a", "The same statement", { aliases: [shared] }),
      {
        knowledgeNodeId: "dataset-b",
        repositoryId: "repo-b",
        localNodeId: "dataset-b",
        kind: "dataset",
        aliases: [shared],
      },
    ]);
    expect(report.proposals).toEqual([]);
  });

  it("returns stable proposal ordering and hashes for shuffled input and alias order", () => {
    const inputs = [
      claim("node-c", "repo-c", "Repeated claim text.", {
        aliases: [
          {
            scheme: "openalex",
            role: "work-openalex",
            value: "https://openalex.org/w123/",
            isExample: false,
          },
          { scheme: "pmid", role: "work-pmid", value: "0007", isExample: false },
        ],
      }),
      claim("node-a", "repo-a", "Repeated claim text.", {
        aliases: [{ scheme: "pmid", role: "work-pmid", value: "7", isExample: false }],
      }),
      claim("node-b", "repo-b", "Repeated claim text."),
    ];
    const first = proposeNodeIdentities(inputs);
    const shuffled = proposeNodeIdentities([
      inputs[1]!,
      { ...inputs[0]!, aliases: [...inputs[0]!.aliases].reverse() },
      inputs[2]!,
    ]);
    expect(shuffled).toEqual(first);
    expect(first.proposals.map((proposal) => proposal.proposalId)).toEqual(
      [...first.proposals.map((proposal) => proposal.proposalId)].sort(),
    );
  });

  it("orders composed and decomposed Unicode identities by code units, independent of input", () => {
    const composed = claim("node-composed", "répo", "Repeated deterministic claim text.");
    const decomposed = claim("node-decomposed", "re\u0301po", "Repeated deterministic claim text.");
    const first = proposeNodeIdentities([composed, decomposed]);
    const reversed = proposeNodeIdentities([decomposed, composed]);
    expect(first).toEqual(reversed);
    expect(first.proposals).toHaveLength(1);
  });

  it("fails closed on duplicate database or stable identities", () => {
    expect(() =>
      proposeNodeIdentities([
        claim("node-a", "repo-a", "One claim"),
        claim("node-a", "repo-b", "Another claim"),
      ]),
    ).toThrow(/Duplicate knowledge-node id/);
    expect(() =>
      proposeNodeIdentities([
        claim("node-a", "repo-a", "One claim", { localNodeId: "same" }),
        claim("node-b", "repo-a", "Another claim", { localNodeId: "same" }),
      ]),
    ).toThrow(/Duplicate stable node identity/);
  });
});
