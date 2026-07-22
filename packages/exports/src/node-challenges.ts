import { canonicalJson, type PublicChallenge } from "@oratlas/contracts";

export interface NodeChallengeExportInput {
  nodeId: string;
  canonicalNodeUrl: string;
  challengeJsonUrl: string;
  challenges: PublicChallenge[];
  nextCursor: string | null;
}

export interface NodeChallengeExportDocument {
  schemaVersion: "1.0.0";
  node: { id: string; url: string };
  challenges: PublicChallenge[];
  nextCursor: string | null;
}

/** Canonical, privacy-filtered node challenge register. */
export function nodeChallengeExportDocument(
  input: NodeChallengeExportInput,
): NodeChallengeExportDocument {
  return {
    schemaVersion: "1.0.0",
    node: { id: input.nodeId, url: input.canonicalNodeUrl },
    challenges: [...input.challenges].sort((left, right) => left.id.localeCompare(right.id)),
    nextCursor: input.nextCursor,
  };
}

export function nodeChallengeJson(input: NodeChallengeExportInput): string {
  return `${canonicalJson(nodeChallengeExportDocument(input))}\n`;
}

/** Minimal RO-Crate graph for the standalone node challenge register. */
export function nodeChallengeRoCrate(input: NodeChallengeExportInput) {
  const document = nodeChallengeExportDocument(input);
  const exportUrl = input.challengeJsonUrl;
  return {
    "@context": "https://w3id.org/ro/crate/1.1/context",
    "@graph": [
      {
        "@id": "ro-crate-metadata.json",
        "@type": "CreativeWork",
        conformsTo: { "@id": "https://w3id.org/ro/crate/1.1" },
        about: { "@id": "./" },
      },
      {
        "@id": "./",
        "@type": "Dataset",
        name: `ORAtlas node challenge register ${input.nodeId}`,
        url: input.canonicalNodeUrl,
        hasPart: [{ "@id": exportUrl }],
        mentions: document.challenges.map((challenge) => ({
          "@id": `${input.canonicalNodeUrl}#challenge-${encodeURIComponent(challenge.id)}`,
        })),
      },
      {
        "@id": exportUrl,
        "@type": "File",
        encodingFormat: "application/vnd.oratlas.node-challenges+json",
        about: { "@id": input.canonicalNodeUrl },
      },
      ...document.challenges.map((challenge) => ({
        "@id": `${input.canonicalNodeUrl}#challenge-${encodeURIComponent(challenge.id)}`,
        "@type": "Comment",
        about: { "@id": new URL(challenge.subjectHref, input.canonicalNodeUrl).href },
        text: challenge.body,
        dateCreated: challenge.createdAt,
        creator: { name: challenge.challenger.githubLogin },
        actionStatus: challenge.status,
        identifier: challenge.canonicalSubjectHash,
        "https://oratlas.org/ns/containerType": challenge.containerType,
        "https://oratlas.org/ns/nodeEdgeProposalId": challenge.nodeEdgeProposalId,
        "https://oratlas.org/ns/filedContentHash": challenge.filedContentHash,
        "https://oratlas.org/ns/lifecycle": challenge.transitions.map((transition) => ({
          fromStatus: transition.fromStatus,
          toStatus: transition.toStatus,
          actor: transition.actor.githubLogin,
          createdAt: transition.createdAt,
        })),
      })),
    ],
  };
}
