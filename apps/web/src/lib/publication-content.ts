import "server-only";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  normalizedPublicationContentSchema,
  type NormalizedPublicationContent,
} from "@oratlas/contracts";
import { prisma } from "./db";

export class PublicationContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationContentError";
  }
}

export function parsePersistedPublicationContent(row: {
  contentCorpusJson: string;
  contentCorpusSha256: string;
  contentCompletenessJson: string;
}): NormalizedPublicationContent {
  const digest = createHash("sha256").update(row.contentCorpusJson, "utf8").digest("hex");
  if (digest !== row.contentCorpusSha256) {
    throw new PublicationContentError(
      "The immutable publication content corpus failed integrity validation.",
    );
  }
  let parsed: NormalizedPublicationContent;
  try {
    parsed = normalizedPublicationContentSchema.parse({
      documents: JSON.parse(row.contentCorpusJson),
      completeness: JSON.parse(row.contentCompletenessJson),
    });
  } catch {
    throw new PublicationContentError("The immutable publication content corpus is malformed.");
  }
  if (canonicalJson(parsed.documents) !== row.contentCorpusJson) {
    throw new PublicationContentError("The immutable publication content corpus is not canonical.");
  }
  if (canonicalJson(parsed.completeness) !== row.contentCompletenessJson) {
    throw new PublicationContentError(
      "The immutable publication content completeness metadata is not canonical.",
    );
  }
  for (const document of parsed.documents) {
    const documentDigest = createHash("sha256").update(document.text, "utf8").digest("hex");
    if (documentDigest !== document.sha256) {
      throw new PublicationContentError(
        `Publication content document '${document.id}' failed integrity validation.`,
      );
    }
  }
  return parsed;
}

export async function getPublicationVersionContent(publicationVersionId: string) {
  const version = await prisma.publicationVersion.findUnique({
    where: { id: publicationVersionId },
    select: {
      id: true,
      contentCorpusJson: true,
      contentCorpusSha256: true,
      contentCompletenessJson: true,
    },
  });
  if (!version) throw new PublicationContentError("Publication version not found.");
  const content = parsePersistedPublicationContent(version);
  return {
    schemaVersion: "1.0.0" as const,
    publicationVersionId: version.id,
    content: content.documents,
    completeness: content.completeness,
    sha256: version.contentCorpusSha256,
    links: {
      publicationVersion: `/api/publication-versions/${version.id}`,
      packet: `/api/publication-versions/${version.id}/packet`,
    },
  };
}
