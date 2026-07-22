import { describe, expect, it } from "vitest";
import type { PublicChallenge } from "@oratlas/contracts";
import {
  nodeChallengeExportDocument,
  nodeChallengeJson,
  nodeChallengeRoCrate,
} from "./node-challenges.js";

const challenge: PublicChallenge = {
  id: "node-challenge-1",
  containerType: "node-relation",
  reviewVersionId: null,
  nodeEdgeProposalId: "proposal-1",
  subjectType: "adjudication",
  subjectLabel: "Adjudication adjudication-1",
  subjectHref: "/nodes/node-1#adjudication-adjudication-1",
  canonicalSubjectHash: "a".repeat(64),
  filedContentHash: "b".repeat(64),
  grounds: "methodology",
  body: "Public challenge body.",
  contentStatus: "visible",
  contentRevision: 0,
  status: "resolved",
  revision: 2,
  challenger: { githubLogin: "challenger", displayName: null },
  transitions: [
    {
      id: "transition-0",
      fromStatus: null,
      toStatus: "open",
      actor: { githubLogin: "challenger" },
      conflictOfInterest: { status: "not-provided" },
      revision: 0,
      createdAt: "2026-07-22T00:00:00.000Z",
    },
    {
      id: "transition-1",
      fromStatus: "open",
      toStatus: "author-responded",
      actor: { githubLogin: "source-author" },
      conflictOfInterest: { status: "not-provided" },
      revision: 1,
      createdAt: "2026-07-22T01:00:00.000Z",
    },
    {
      id: "transition-2",
      fromStatus: "author-responded",
      toStatus: "resolved",
      actor: { githubLogin: "editor" },
      conflictOfInterest: { status: "none-declared" },
      revision: 2,
      createdAt: "2026-07-22T02:00:00.000Z",
    },
  ],
  response: {
    id: "response-1",
    body: "Public response.",
    contentHash: "c".repeat(64),
    contentStatus: "visible",
    contentRevision: 0,
    responder: { githubLogin: "source-author", displayName: null },
    createdAt: "2026-07-22T01:00:00.000Z",
  },
  createdAt: "2026-07-22T00:00:00.000Z",
};

const input = {
  nodeId: "node-1",
  canonicalNodeUrl: "https://atlas.example/nodes/node-1",
  challengeJsonUrl: "https://atlas.example/api/nodes/node-1/exports/challenges.json",
  challenges: [challenge],
  nextCursor: null,
};

describe("node challenge scholarly exports", () => {
  it("preserves the exact non-fictional container, subject binding, and public lifecycle", () => {
    const document = nodeChallengeExportDocument(input);
    expect(document).toMatchObject({
      node: { id: "node-1", url: "https://atlas.example/nodes/node-1" },
      challenges: [
        {
          containerType: "node-relation",
          reviewVersionId: null,
          nodeEdgeProposalId: "proposal-1",
          subjectHref: "/nodes/node-1#adjudication-adjudication-1",
          canonicalSubjectHash: "a".repeat(64),
          filedContentHash: "b".repeat(64),
          revision: 2,
        },
      ],
    });
    const serialized = nodeChallengeJson(input);
    expect(serialized).toContain('"nodeEdgeProposalId":"proposal-1"');
    expect(serialized).toContain('"toStatus":"resolved"');
    for (const privateField of [
      "rationale",
      "actorRoleSnapshot",
      "removedById",
      "contributorPersonId",
      "nodeContributorUserId",
    ]) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it("emits an RO-Crate comment with the exact deep link, hash, container, and lifecycle", () => {
    const crate = nodeChallengeRoCrate(input);
    expect(JSON.stringify(crate)).toContain(
      "https://atlas.example/api/nodes/node-1/exports/challenges.json",
    );
    const entity = crate["@graph"].find(
      (item) => item["@id"] === "https://atlas.example/nodes/node-1#challenge-node-challenge-1",
    );
    expect(entity).toMatchObject({
      about: { "@id": "https://atlas.example/nodes/node-1#adjudication-adjudication-1" },
      identifier: "a".repeat(64),
      "https://oratlas.org/ns/containerType": "node-relation",
      "https://oratlas.org/ns/nodeEdgeProposalId": "proposal-1",
      "https://oratlas.org/ns/filedContentHash": "b".repeat(64),
      "https://oratlas.org/ns/lifecycle": expect.arrayContaining([
        expect.objectContaining({ toStatus: "resolved", actor: "editor" }),
      ]),
    });
  });

  it("preserves the exact paginated JSON URL advertised by a page-2 RO-Crate", () => {
    const pageTwo = nodeChallengeRoCrate({
      ...input,
      challengeJsonUrl:
        "https://atlas.example/api/nodes/node-1/exports/challenges.json?cursor=challenge-50&limit=25",
      nextCursor: "challenge-75",
    });
    expect(JSON.stringify(pageTwo)).toContain(
      "https://atlas.example/api/nodes/node-1/exports/challenges.json?cursor=challenge-50&limit=25",
    );
  });
});
