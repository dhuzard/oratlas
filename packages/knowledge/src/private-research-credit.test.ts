import { describe, expect, it } from "vitest";
import { PRIVATE_CROSS_FINDING_VERSION, privateCrossFindingSchema } from "@oratlas/contracts";
import {
  projectPersonalResearchCredit,
  type AuthorizePrivateResearchProject,
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

/** Records every request; answers from `grants`. */
function recordingChecker(grants: Set<string>) {
  const calls: PrivateResearchPermissionRequest[] = [];
  const authorize: AuthorizePrivateResearchProject = (request) => {
    calls.push(request);
    return grants.has(request.projectId + ":" + request.permission);
  };
  return { authorize, calls };
}

const GRANTS = [
  "project:A:read",
  "project:A:cross-project-process",
  "project:B:read",
  "project:B:cross-project-process",
] as const;

const both = () => new Set<string>(GRANTS);

const PRIVATE_TEXT = ["Private A curator", "Private B author", "finding:A", "claim:B"];

function expectNothingDisclosed(result: unknown) {
  expect(result).toBeNull();
  for (const text of PRIVATE_TEXT) expect(JSON.stringify(result)).not.toContain(text);
}

describe("permission-aware personal cross-project attribution", () => {
  it("returns the exact, unchanged strict DTO to the owner holding all four grants", async () => {
    const result = await projectPersonalResearchCredit(candidate(), "user:R", checker(both()));
    expect(result).toEqual(privateCrossFindingSchema.parse(candidate()));
    expect(result).toEqual(candidate());
    expect(
      result?.sources.map(({ projectId, artifactId, artifactVersion, artifactSha256 }) => ({
        projectId,
        artifactId,
        artifactVersion,
        artifactSha256,
      })),
    ).toEqual([
      {
        projectId: "project:A",
        artifactId: "finding:A",
        artifactVersion: "revision:2",
        artifactSha256: sha("a"),
      },
      {
        projectId: "project:B",
        artifactId: "claim:B",
        artifactVersion: "review-version:1",
        artifactSha256: sha("b"),
      },
    ]);
    // Credit stays an asserted, source-declared claim; nothing is upgraded to confirmed.
    expect(
      result?.credit.map((c) => [c.person.displayName, c.assertionStatus, c.assertionOrigin]),
    ).toEqual([
      ["Private A curator", "proposed", "source-declared"],
      ["Private B author", "proposed", "source-declared"],
    ]);
    // Software provenance stays software: no ORCID, no CRediT human role.
    expect(result?.activities).toEqual([
      expect.objectContaining({ actorKind: "software", softwareId: "agent:compare" }),
    ]);
    expect(JSON.stringify(result?.activities)).not.toMatch(/orcid|creditRole/iu);
  });

  it("asks for read and cross-project-process per source project, with project ids only", async () => {
    // Observed current contract: the callback never receives artifact ids, versions or hashes,
    // so it cannot enforce exact-object, class or withheld-content policy by itself.
    const { authorize, calls } = recordingChecker(both());
    await projectPersonalResearchCredit(candidate(), "user:R", authorize);
    expect(calls).toEqual([
      { principalId: "user:R", projectId: "project:A", permission: "read" },
      { principalId: "user:R", projectId: "project:A", permission: "cross-project-process" },
      { principalId: "user:R", projectId: "project:B", permission: "read" },
      { principalId: "user:R", projectId: "project:B", permission: "cross-project-process" },
    ]);
  });

  it.each([
    ["owner holding only project A grants", ["project:A:read", "project:A:cross-project-process"]],
    ["owner holding only project B grants", ["project:B:read", "project:B:cross-project-process"]],
    ["owner holding no grants", []],
  ])("returns null for the %s", async (_label, grants) => {
    expectNothingDisclosed(
      await projectPersonalResearchCredit(candidate(), "user:R", checker(new Set(grants))),
    );
  });

  it.each(GRANTS)("returns null when only %s is missing", async (missing) => {
    const grants = both();
    grants.delete(missing);
    expectNothingDisclosed(
      await projectPersonalResearchCredit(candidate(), "user:R", checker(grants)),
    );
  });

  it.each(GRANTS)("fails closed on the next request after %s is revoked", async (revoked) => {
    const grants = both();
    expect(
      await projectPersonalResearchCredit(candidate(), "user:R", checker(grants)),
    ).not.toBeNull();
    grants.delete(revoked);
    expectNothingDisclosed(
      await projectPersonalResearchCredit(candidate(), "user:R", checker(grants)),
    );
  });

  it.each([
    ["anonymous (null)", null],
    ["anonymous (undefined)", undefined],
    ["anonymous (empty principal)", ""],
    ["non-owner A+B member holding every grant", "user:Q"],
    // Labels only: these principal ids carry no authority in the projector, and these cases say
    // nothing about database, KMS or infrastructure isolation.
    ["platform-admin label with no membership", "user:platform-admin"],
    ["infra-admin label with no membership", "user:infra-admin"],
  ])("returns null for %s without invoking authorize", async (_label, principal) => {
    const { authorize, calls } = recordingChecker(both());
    expectNothingDisclosed(await projectPersonalResearchCredit(candidate(), principal, authorize));
    expect(calls).toEqual([]);
  });

  it("treats a synchronous throw, async rejection or non-boolean answer as not found", async () => {
    for (const authorize of [
      () => {
        throw Error("Membership provider unavailable");
      },
      () => Promise.reject(new Error("Membership provider unavailable")),
      async () => {
        throw new Error("Consent service timeout");
      },
      () => ({ permitted: true }) as unknown as boolean,
      () => Promise.resolve("true" as unknown as boolean),
    ] satisfies AuthorizePrivateResearchProject[]) {
      expectNothingDisclosed(await projectPersonalResearchCredit(candidate(), "user:R", authorize));
    }
    expect(
      await projectPersonalResearchCredit(candidate(), "user:R", async () => true),
    ).not.toBeNull();
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
