import { describe, expect, it } from "vitest";
import { CREDIT_ROLES } from "./editorial.js";
import {
  CREDIT_ROLE_IDS,
  CREDIT_ROLE_LABELS,
  PRIVATE_CROSS_FINDING_VERSION,
  privateCreditRoleSchema,
  privateCrossFindingSchema,
} from "./private-research-credit.js";

const sha = (char: string) => "sha256:" + char.repeat(64);

export function examplePrivateCrossFinding() {
  return {
    schemaVersion: PRIVATE_CROSS_FINDING_VERSION,
    findingId: "personal-hypothesis:1",
    revision: 1,
    ownerSubjectId: "user:researcher",
    visibility: "owner-only",
    state: "candidate",
    relation: "potentially-related",
    hypothesis: "A's effect and B's effect may share a mechanism.",
    createdAt: "2026-10-18T09:00:00Z",
    sources: [
      {
        sourceKey: "source:a",
        projectId: "project:a",
        producer: "diggypaper",
        kind: "source-paper-finding",
        artifactId: "finding:a",
        artifactVersion: "revision:3",
        artifactSha256: sha("a"),
        sourceSnapshotSha256: sha("b"),
        doi: "10.1111/source-a",
      },
      {
        sourceKey: "source:b",
        projectId: "project:b",
        producer: "computational-review-template",
        kind: "review-claim",
        artifactId: "claim:b",
        artifactVersion: "review-version:2",
        artifactSha256: sha("c"),
      },
    ],
    credit: [
      {
        assertionId: "credit:original-paper",
        target: { kind: "source", sourceKey: "source:a" },
        person: {
          sourcePersonId: "bibliography:author-1",
          displayName: "Dr A",
          assertedOrcid: "0000-0002-1825-0097",
        },
        capacity: "publication-author",
        assertionStatus: "proposed",
        assertionOrigin: "source-declared",
        evidenceRefSha256: sha("d"),
        assertedAt: "2026-10-18T09:01:00Z",
      },
      {
        assertionId: "credit:curator",
        target: { kind: "source", sourceKey: "source:a" },
        person: { sourcePersonId: "person:curator", displayName: "Dr C" },
        capacity: "source-finding-curator",
        creditRole: "data-curation",
        assertionStatus: "confirmed",
        assertionOrigin: "human-confirmed",
        evidenceRefSha256: sha("e"),
        assertedAt: "2026-10-18T09:02:00Z",
      },
      {
        assertionId: "credit:bridge",
        target: { kind: "cross-finding" },
        person: { sourcePersonId: "user:researcher", displayName: "Researcher R" },
        capacity: "cross-finding-contributor",
        creditRole: "conceptualization",
        assertionStatus: "confirmed",
        assertionOrigin: "human-confirmed",
        evidenceRefSha256: sha("f"),
        assertedAt: "2026-10-18T09:03:00Z",
      },
    ],
    activities: [
      {
        activityId: "activity:agent-1",
        actorKind: "software",
        kind: "proposed-connection",
        softwareId: "software:compare",
        softwareVersion: "version:1",
        runId: "run:abc",
        at: "2026-10-18T09:04:00Z",
        inputSha256: [sha("a"), sha("c")],
      },
      {
        activityId: "activity:human-1",
        actorKind: "human",
        kind: "curated-connection",
        localSubjectId: "user:researcher",
        at: "2026-10-18T09:05:00Z",
        inputSha256: [sha("a"), sha("c")],
      },
    ],
  };
}

describe("versioned private cross-finding / CRediT contracts", () => {
  it("supports exactly the 14 CRediT roles and canonical human labels", () => {
    expect(CREDIT_ROLE_IDS).toHaveLength(14);
    expect(CREDIT_ROLE_IDS).toEqual(CREDIT_ROLES);
    expect(new Set(CREDIT_ROLE_IDS).size).toBe(14);
    expect(Object.keys(CREDIT_ROLE_LABELS)).toHaveLength(14);
    expect(privateCreditRoleSchema.safeParse("validation").success).toBe(true);
    expect(
      privateCreditRoleSchema.safeParse("automated-scientific-authorship").success,
    ).toBe(false);
    expect(CREDIT_ROLE_LABELS["writing-review-editing"]).toBe("Writing – review & editing");
  });

  it("preserves distinct versioned source provenance, source authors, bridge credit and AI runs", () => {
    const record = privateCrossFindingSchema.parse(examplePrivateCrossFinding());
    expect(record.visibility).toBe("owner-only");
    expect(record.sources.map((source) => source.projectId)).toEqual(["project:a", "project:b"]);
    expect(record.sources[0]?.sourceSnapshotSha256).toBe(sha("b"));
    expect(record.credit[0]?.creditRole).toBeUndefined();
    expect(record.credit[0]?.capacity).toBe("publication-author");
    expect(record.credit[2]).toMatchObject({
      capacity: "cross-finding-contributor",
      creditRole: "conceptualization",
      assertionOrigin: "human-confirmed",
    });
    expect(record.activities[0]).toMatchObject({
      actorKind: "software",
      softwareId: "software:compare",
    });
    expect(JSON.stringify(record.credit)).not.toContain("software:compare");
  });

  it("requires cross-project source identity and exact immutable hashes", () => {
    const sameProject = examplePrivateCrossFinding();
    sameProject.sources[1]!.projectId = "project:a";
    expect(privateCrossFindingSchema.safeParse(sameProject).success).toBe(false);
    const repeatedSource = examplePrivateCrossFinding();
    repeatedSource.sources[1]!.sourceKey = "source:a";
    expect(privateCrossFindingSchema.safeParse(repeatedSource).success).toBe(false);
    const wrongHash = examplePrivateCrossFinding();
    wrongHash.sources[0]!.artifactSha256 = "draft-rev";
    expect(privateCrossFindingSchema.safeParse(wrongHash).success).toBe(false);
  });

  it("rejects a source-person wrongly credited as author of the bridging hypothesis", () => {
    const record = examplePrivateCrossFinding();
    record.credit[0]!.target = { kind: "cross-finding" };
    expect(privateCrossFindingSchema.safeParse(record).success).toBe(false);
  });

  it("refuses forged confirmations, unknown CRediT roles and orphan source credits", () => {
    const notReviewed = examplePrivateCrossFinding();
    notReviewed.credit[2]!.assertionOrigin = "source-declared";
    expect(privateCrossFindingSchema.safeParse(notReviewed).success).toBe(false);
    const guessedRole = examplePrivateCrossFinding();
    guessedRole.credit[2]!.creditRole = "AI writing";
    expect(privateCrossFindingSchema.safeParse(guessedRole).success).toBe(false);
    const orphan = examplePrivateCrossFinding();
    orphan.credit[1]!.target = { kind: "source", sourceKey: "source:secret" };
    expect(privateCrossFindingSchema.safeParse(orphan).success).toBe(false);
  });

  it("blocks publication or user disclosure fields at the contract boundary", () => {
    const record = { ...examplePrivateCrossFinding(), visibility: "public" };
    expect(privateCrossFindingSchema.safeParse(record).success).toBe(false);
    const extra = { ...examplePrivateCrossFinding(), publicUrl: "https://example.org" };
    expect(privateCrossFindingSchema.safeParse(extra).success).toBe(false);
  });

  it("rejects duplicate credit and agent-run identities", () => {
    const dupCredit = examplePrivateCrossFinding();
    dupCredit.credit[1]!.assertionId = dupCredit.credit[0]!.assertionId;
    expect(privateCrossFindingSchema.safeParse(dupCredit).success).toBe(false);
    const dupActivity = examplePrivateCrossFinding();
    dupActivity.activities[1]!.activityId = dupActivity.activities[0]!.activityId;
    expect(privateCrossFindingSchema.safeParse(dupActivity).success).toBe(false);
  });
});
