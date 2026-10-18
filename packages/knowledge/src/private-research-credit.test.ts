import { describe, expect, it } from "vitest";
import { PRIVATE_CROSS_FINDING_VERSION } from "@oratlas/contracts";
import {
  projectPersonalResearchCredit,
  type PrivateResearchPermissionRequest,
} from "./private-research-credit.js";

const sha = (c: string) => "sha256:" + c.repeat(64);

function candidate() {
  return {
    schemaVersion: PRIVATE_CROSS_FINDING_VERSION,
    findingId: "hypothesis:1",
    revision: 1,
    ownerSubjectId: "user:R",
    visibility: "owner-only",
    state: "candidate",
    relation: "research-question",
    hypothesis: "A and B may expose a shared mechanism.",
    createdAt: "2026-10-18T09:00:00Z",
    sources: [
      {
        sourceKey: "source:A",
        projectId: "project:A",
        producer: "diggypaper",
        kind: "source-paper-finding",
        artifactId: "finding:A",
        artifactVersion: "revision:2",
        artifactSha256: sha("a"),
      },
      {
        sourceKey: "source:B",
        projectId: "project:B",
        producer: "computational-review-template",
        kind: "review-claim",
        artifactId: "claim:B",
        artifactVersion: "review-version:1",
        artifactSha256: sha("b"),
      },
    ],
    credit: [
      {
        assertionId: "credit:A",
        target: { kind: "source", sourceKey: "source:A" },
        person: { sourcePersonId: "person:private-A", displayName: "Private A curator" },
        capacity: "source-finding-curator",
        creditRole: "data-curation",
        assertionStatus: "proposed",
        assertionOrigin: "source-declared",
        evidenceRefSha256: sha("a"),
        assertedAt: "2026-10-18T09:00:00Z",
      },
      {
        assertionId: "credit:B",
        target: { kind: "source", sourceKey: "source:B" },
        person: { sourcePersonId: "person:private-B", displayName: "Private B author" },
        capacity: "review-author",
        assertionStatus: "proposed",
        assertionOrigin: "source-declared",
        evidenceRefSha256: sha("b"),
        assertedAt: "2026-10-18T09:00:00Z",
      },
    ],
    activities: [
      {
        activityId: "run:comparison",
        actorKind: "software",
        kind: "proposed-connection",
        softwareId: "agent:compare",
        softwareVersion: "version:1",
        runId: "run:1",
        at: "2026-10-18T09:00:00Z",
        inputSha256: [sha("a"), sha("b")],
      },
    ],
  };
}

function checker(grants: Set<string>) {
  return ({ projectId, permission }: PrivateResearchPermissionRequest) =>
    grants.has(projectId + ":" + permission);
}

const both = () =>
  new Set([
    "project:A:read",
    "project:A:cross-project-process",
    "project:B:read",
    "project:B:cross-project-process",
  ]);

describe("permission-aware personal cross-project attribution", () => {
  it("returns the exact source and credit trail only for its owner with both grants", async () => {
    const result = await projectPersonalResearchCredit(candidate(), "user:R", checker(both()));
    expect(result).toMatchObject({
      ownerSubjectId: "user:R",
      state: "candidate",
      visibility: "owner-only",
    });
    expect(result?.sources.map((source) => source.projectId)).toEqual(["project:A", "project:B"]);
    expect(result?.credit.map((assertion) => assertion.person.displayName)).toEqual([
      "Private A curator",
      "Private B author",
    ]);
    expect(result?.activities[0]?.actorKind).toBe("software");
  });

  it("never reveals a personal insight to another member, even with both project grants", async () => {
    let invoked = false;
    const result = await projectPersonalResearchCredit(candidate(), "user:A-only", () => {
      invoked = true;
      return true;
    });
    expect(result).toBeNull();
    expect(invoked).toBe(false);
  });

  it("fails closed if an A+B member loses B access on a subsequent request", async () => {
    const grants = both();
    expect(
      await projectPersonalResearchCredit(candidate(), "user:R", checker(grants)),
    ).not.toBeNull();
    grants.delete("project:B:read");
    const revoked = await projectPersonalResearchCredit(candidate(), "user:R", checker(grants));
    expect(revoked).toBeNull();
    expect(JSON.stringify(revoked)).not.toContain("Private B author");
  });

  it("requires independent cross-project processing consent from both projects", async () => {
    const grants = both();
    grants.delete("project:B:cross-project-process");
    expect(await projectPersonalResearchCredit(candidate(), "user:R", checker(grants))).toBeNull();
    grants.add("project:B:cross-project-process");
    grants.delete("project:A:cross-project-process");
    expect(await projectPersonalResearchCredit(candidate(), "user:R", checker(grants))).toBeNull();
  });

  it("treats authorization failure and unknown/principal-less requests as not found", async () => {
    expect(
      await projectPersonalResearchCredit(candidate(), "user:R", () => {
        throw Error("Membership provider unavailable");
      }),
    ).toBeNull();
    expect(await projectPersonalResearchCredit(candidate(), null, () => true)).toBeNull();
    expect(
      await projectPersonalResearchCredit(
        candidate(),
        "user:R",
        () => ({ permitted: true }) as unknown as boolean,
      ),
    ).toBeNull();
  });

  it("rejects malformed, public-looking or same-project records without disclosing content", async () => {
    for (const record of [null, [], "", 12, { ...candidate(), visibility: "public" }]) {
      expect(await projectPersonalResearchCredit(record, "user:R", () => true)).toBeNull();
    }
    const oneProject = candidate();
    oneProject.sources[1]!.projectId = "project:A";
    expect(await projectPersonalResearchCredit(oneProject, "user:R", () => true)).toBeNull();
  });

  it("never uses an ORCID string, bibliographic DOI or assertion as an access grant", async () => {
    const fake = candidate();
    fake.credit[0]!.person.displayName = "0000-0002-1825-0097";
    expect(await projectPersonalResearchCredit(fake, "user:R", () => false)).toBeNull();
  });
});
