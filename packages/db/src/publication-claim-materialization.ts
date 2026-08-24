import {
  canonicalJson,
  claimNodePayloadSchema,
  knowledgeNodeProvenanceSchema,
  publicationClaimSelectorSchema,
  publicationClaimSourceBindingSchema,
  publicationClaimTargetSchema,
  publicationHttpsUrlSchema,
} from "@oratlas/contracts";
import type { Prisma } from "../generated/client/index.js";
import { resolveObservedPublicationBaseUrl } from "./publication-addressing.js";

export class PublicationClaimMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicationClaimMaterializationError";
  }
}

export interface PublicationClaimMaterializationReport {
  publicationClaimOccurrenceId: string;
  knowledgeNodeId: string;
  knowledgeNodeVersionId: string;
  idempotent: boolean;
}

/**
 * Materialize one already-normalized publication occurrence into the existing
 * canonical graph. The caller owns the transaction. This layer deliberately
 * knows nothing about MyST (or any future authoring adapter).
 */
export async function materializePublicationClaimOccurrence(
  tx: Prisma.TransactionClient,
  occurrenceId: string,
): Promise<PublicationClaimMaterializationReport> {
  const occurrence = await tx.publicationClaimOccurrence.findUnique({
    where: { id: occurrenceId },
    include: {
      publicationVersion: {
        include: {
          publication: true,
          captures: {
            select: {
              id: true,
              artifactKind: true,
              observedUrl: true,
              requestedUrl: true,
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          },
        },
      },
      graphVersion: true,
      knowledgeNode: true,
    },
  });
  if (!occurrence) throw new PublicationClaimMaterializationError("Claim occurrence not found.");
  if (!occurrence.text) {
    throw new PublicationClaimMaterializationError(
      "The occurrence has no authoritative claim declaration.",
    );
  }
  const publishedUrl = publicationHttpsUrlSchema.safeParse(occurrence.publishedUrl);
  if (!publishedUrl.success) {
    throw new PublicationClaimMaterializationError(
      "The occurrence has no exact verified published target URL.",
    );
  }
  const target = parseStored(occurrence.targetJson, publicationClaimTargetSchema, "claim target");
  const sourceBinding = parseStored(
    occurrence.sourceBindingJson,
    publicationClaimSourceBindingSchema,
    "source binding",
  );
  const selector = parseStored(
    occurrence.selectorJson,
    publicationClaimSelectorSchema,
    "claim selector",
  );
  const version = occurrence.publicationVersion;
  const observedBaseUrl = resolveObservedPublicationBaseUrl(version);
  if (!observedBaseUrl) {
    throw new PublicationClaimMaterializationError(
      "The publication version has no valid observed publication base URL.",
    );
  }
  const publisherCanonicalUrl = publicationHttpsUrlSchema.safeParse(version.canonicalUrl);
  if (version.canonicalUrl !== null && !publisherCanonicalUrl.success) {
    throw new PublicationClaimMaterializationError(
      "The publication version has an invalid publisher-declared canonical URL.",
    );
  }
  const provenanceAddress = publisherCanonicalUrl.success
    ? publisherCanonicalUrl.data
    : observedBaseUrl;

  if (occurrence.graphVersion) {
    assertExactBinding(occurrence, occurrence.graphVersion.knowledgeNodeId);
    assertGraphVersion(
      occurrence.graphVersion,
      expectedVersionFields(occurrence, provenanceAddress),
    );
    return {
      publicationClaimOccurrenceId: occurrence.id,
      knowledgeNodeId: occurrence.graphVersion.knowledgeNodeId,
      knowledgeNodeVersionId: occurrence.graphVersion.id,
      idempotent: true,
    };
  }

  let node = occurrence.knowledgeNode;
  if (node) {
    if (node.kind !== "claim") {
      throw new PublicationClaimMaterializationError(
        "The reviewed occurrence binding does not reference a canonical claim.",
      );
    }
  } else {
    const stableKey = `claim:${occurrence.stableKey}`;
    node = await tx.knowledgeNode.upsert({
      where: { stableKey },
      update: {},
      create: {
        stableKey,
        originType: "claim-occurrence",
        localNodeId: occurrence.id,
        kind: "claim",
      },
    });
    if (
      node.repositoryId !== null ||
      node.originType !== "claim-occurrence" ||
      node.localNodeId !== occurrence.id ||
      node.kind !== "claim"
    ) {
      throw new PublicationClaimMaterializationError(
        "The occurrence stable key is bound to an incompatible canonical identity.",
      );
    }
  }

  const fields = expectedVersionFields(occurrence, provenanceAddress, {
    target,
    sourceBinding,
    selector,
    captureIds: version.captures.map((capture) => capture.id),
  });
  const graphVersion = await tx.knowledgeNodeVersion.create({
    data: {
      knowledgeNodeId: node.id,
      sourcePublicationClaimOccurrenceId: occurrence.id,
      ...fields,
    },
  });
  if (!occurrence.knowledgeNodeId) {
    const binding = await tx.publicationClaimOccurrence.updateMany({
      where: { id: occurrence.id, knowledgeNodeId: null },
      data: { knowledgeNodeId: node.id },
    });
    if (binding.count !== 1) {
      const current = await tx.publicationClaimOccurrence.findUnique({
        where: { id: occurrence.id },
        select: { id: true, knowledgeNodeId: true },
      });
      if (!current || current.knowledgeNodeId !== node.id) {
        throw new PublicationClaimMaterializationError(
          `Occurrence '${occurrence.id}' has a conflicting canonical identity binding.`,
        );
      }
    }
  } else {
    assertExactBinding(occurrence, node.id);
  }
  return {
    publicationClaimOccurrenceId: occurrence.id,
    knowledgeNodeId: node.id,
    knowledgeNodeVersionId: graphVersion.id,
    idempotent: false,
  };
}

function parseStored<T>(
  value: string,
  schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
  label: string,
): T {
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    if (parsed.success) return parsed.data;
  } catch {
    // Converted to one fail-closed domain error below.
  }
  throw new PublicationClaimMaterializationError(`The stored ${label} is invalid.`);
}

function expectedVersionFields(
  occurrence: {
    id: string;
    text: string | null;
    claimType: string | null;
    qualification: string | null;
    sourceBindingJson: string;
    selectorJson: string;
    targetJson: string;
    publishedUrl: string | null;
    publicationVersion: {
      id: string;
      publicationId: string;
      adapterType: string;
      structuralProvenance: string;
      sourcesSha256: string;
      observedAt: Date;
      publication: { publicationType: string };
    };
  },
  publicationBaseUrl: string,
  parsed?: { target: unknown; sourceBinding: unknown; selector: unknown; captureIds: string[] },
) {
  const sourceBinding = parsed?.sourceBinding ?? JSON.parse(occurrence.sourceBindingJson);
  const path = publicationClaimSourceBindingSchema.parse(sourceBinding).documentPath;
  return {
    title: null,
    abstract: null,
    text: occurrence.text,
    contributorsJson: "[]",
    license: null,
    provenanceJson: canonicalJson(
      knowledgeNodeProvenanceSchema.parse({
        sourcePath: path,
        sourcePointer: `publication-claim:${occurrence.id}`,
        repositoryUrl: publicationBaseUrl,
        declaredAt: occurrence.publicationVersion.observedAt.toISOString(),
      }),
    ),
    payloadJson: canonicalJson(
      claimNodePayloadSchema.parse({
        statement: occurrence.text,
        qualifiers: occurrence.qualification ? [occurrence.qualification] : [],
      }),
    ),
    versionDoi: null,
    conceptDoi: null,
    isExample: false,
  } as const;
}

function assertExactBinding(
  occurrence: { id: string; knowledgeNodeId: string | null },
  knowledgeNodeId: string,
): void {
  if (occurrence.knowledgeNodeId !== knowledgeNodeId) {
    throw new PublicationClaimMaterializationError(
      `Occurrence '${occurrence.id}' has a conflicting canonical identity binding.`,
    );
  }
}

function assertGraphVersion(
  existing: Record<string, unknown>,
  expected: ReturnType<typeof expectedVersionFields>,
): void {
  const mismatch = Object.entries(expected).find(([key, value]) => existing[key] !== value);
  if (mismatch) {
    throw new PublicationClaimMaterializationError(
      `The exact occurrence graph version conflicts at immutable field '${mismatch[0]}'.`,
    );
  }
}
