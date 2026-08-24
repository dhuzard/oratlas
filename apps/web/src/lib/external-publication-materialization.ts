import "server-only";
import { canonicalJson, publicationClaimMaterializationResultSchema } from "@oratlas/contracts";
import {
  materializePublicationClaimOccurrence,
  type PublicationClaimMaterializationReport,
} from "@oratlas/db";
import { prisma } from "./db";

async function materializeExternalPublicationClaimOnce(occurrenceId: string, actorId: string) {
  const report = await prisma.$transaction(async (tx) => {
    const result = await materializePublicationClaimOccurrence(tx, occurrenceId);
    if (!result.idempotent) {
      await tx.auditEvent.create({
        data: {
          actorId,
          action: "external-publication-claim.materialize",
          subjectType: "publication-claim-occurrence",
          subjectId: occurrenceId,
          idempotencyKey: `external-publication-claim.materialize:${occurrenceId}`,
          detailsJson: canonicalJson({
            knowledgeNodeId: result.knowledgeNodeId,
            knowledgeNodeVersionId: result.knowledgeNodeVersionId,
          }),
        },
      });
    }
    return result;
  });
  return materializationResponse(report);
}

function isUniqueWriteRace(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** Retry one rolled-back uniqueness race so concurrent exact requests converge. */
export async function materializeExternalPublicationClaim(occurrenceId: string, actorId: string) {
  try {
    return await materializeExternalPublicationClaimOnce(occurrenceId, actorId);
  } catch (error) {
    if (!isUniqueWriteRace(error)) throw error;
    return materializeExternalPublicationClaimOnce(occurrenceId, actorId);
  }
}

function materializationResponse(report: PublicationClaimMaterializationReport) {
  const graph = new URLSearchParams({
    seed: report.knowledgeNodeId,
    version: report.knowledgeNodeVersionId,
  });
  return publicationClaimMaterializationResultSchema.parse({
    schemaVersion: "1.0.0",
    ...report,
    links: {
      occurrence: `/api/publication-claim-occurrences/${report.publicationClaimOccurrenceId}`,
      canonicalGraph: `/api/graph?${graph.toString()}`,
      canonicalOccurrence: `/graph/occurrences/${encodeURIComponent(report.knowledgeNodeId)}/versions/${encodeURIComponent(report.knowledgeNodeVersionId)}`,
    },
  });
}
