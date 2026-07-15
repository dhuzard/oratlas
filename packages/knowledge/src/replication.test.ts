import { describe, expect, it } from "vitest";
import {
  REPLICATION_TRIAGE_DISCLAIMER,
  REPLICATION_TRIAGE_METHOD,
  rankReplicationGaps,
  type ReplicationGapCandidate,
} from "./replication.js";

function candidate(
  claimId: string,
  overrides: Partial<ReplicationGapCandidate> = {},
): ReplicationGapCandidate {
  return {
    claimId,
    scopeDeclared: true,
    independence: {
      supportingWorks: 2,
      independentSupportingFamilies: 2,
      opposingWorks: 0,
      independentOpposingFamilies: 0,
      sharedWorkKeys: [],
      circularCitationIds: [],
    },
    contradictions: { genuine: 0, scopeDifference: 0, undeterminedScope: 0 },
    ...overrides,
  };
}

describe("replication evidence-gap triage", () => {
  it("orders transparent categories deterministically without a truth score", () => {
    const inputs = [
      candidate("routine"),
      candidate("scope", { scopeDeclared: false }),
      candidate("single-family", {
        independence: {
          ...candidate("x").independence,
          supportingWorks: 3,
          independentSupportingFamilies: 1,
        },
      }),
      candidate("contradiction", {
        contradictions: { genuine: 1, scopeDifference: 0, undeterminedScope: 0 },
      }),
    ];
    const first = rankReplicationGaps(inputs);
    const second = rankReplicationGaps([...inputs].reverse());

    expect(first).toEqual(second);
    expect(first.map((entry) => entry.claimId)).toEqual([
      "contradiction",
      "single-family",
      "scope",
      "routine",
    ]);
    expect(first[0]).toMatchObject({
      triagePosition: 1,
      triageBand: "contradiction-attention",
      method: REPLICATION_TRIAGE_METHOD,
      disclaimer: REPLICATION_TRIAGE_DISCLAIMER,
    });
    expect(first[0]).not.toHaveProperty("score");
    expect(first[0]).not.toHaveProperty("probability");
  });

  it("surfaces independence, circularity, and missing-scope reasons", () => {
    const [ranked] = rankReplicationGaps([
      candidate("gap", {
        scopeDeclared: false,
        independence: {
          supportingWorks: 3,
          independentSupportingFamilies: 1,
          opposingWorks: 0,
          independentOpposingFamilies: 0,
          sharedWorkKeys: ["doi:10.1/shared"],
          circularCitationIds: ["citation-1"],
        },
      }),
    ]);
    expect(ranked!.signals.map((signal) => signal.code)).toEqual([
      "single-independent-family",
      "duplicated-evidence-family",
      "circular-citation",
      "scope-undeclared",
    ]);
  });

  it("rejects duplicate ids without imposing a corpus-size outage", () => {
    expect(() => rankReplicationGaps([candidate("same"), candidate("same")])).toThrow(/unique/);
    expect(
      rankReplicationGaps(Array.from({ length: 5_001 }, (_, index) => candidate(`claim-${index}`))),
    ).toHaveLength(5_001);
  });
});
