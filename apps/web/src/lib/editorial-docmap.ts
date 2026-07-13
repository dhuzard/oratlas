import "server-only";
import { docmap, type DocmapInput, type DocmapRoundInput } from "@oratlas/exports";
import { appBaseUrl } from "./base-url";
import { prisma } from "./db";
import { getProcessHistory } from "./editorial-lifecycle";
import { getVersionExportContext } from "./preservation";

/**
 * DocMaps-compatible process history for one published immutable version,
 * derived from the version's source submission and its revision lineage.
 * Returns null when the version is not publicly served.
 */
export async function getDocmapForVersion(
  slug: string,
  versionId: string,
): Promise<Record<string, unknown> | null> {
  const context = await getVersionExportContext(slug, versionId);
  if (!context) return null;
  const version = await prisma.reviewVersion.findUnique({
    where: { id: versionId },
    select: { sourceSubmissionId: true, createdAt: true },
  });
  if (!version) return null;

  const history = version.sourceSubmissionId
    ? await getProcessHistory(version.sourceSubmissionId)
    : [];
  const rounds: DocmapRoundInput[] = history.flatMap((entry) =>
    entry.rounds.map((round) => ({
      roundNumber: round.roundNumber,
      openedAt: round.openedAt,
      reports: round.reports.map((report) => ({
        reviewerLogin: report.reviewerLogin,
        reviewerOrcid: report.reviewerOrcid,
        orcidVerified: report.orcidVerified,
        recommendation: report.recommendation,
        submittedAt: report.submittedAt,
      })),
      responses: round.responses.map((response) => ({
        authorLogin: response.authorLogin,
        submittedAt: response.submittedAt,
      })),
      decision: round.decision
        ? {
            editorLogin: round.decision.editorLogin,
            decision: round.decision.decision,
            issuedAt: round.decision.issuedAt,
          }
        : undefined,
    })),
  );

  const first = history[0];
  const input: DocmapInput = {
    id: `${context.exportInput.canonicalUrl}/export/docmap`,
    publisherName: "Open Review Atlas",
    publisherUrl: appBaseUrl(),
    versionUrl: context.exportInput.canonicalUrl,
    versionDoi: context.exportInput.versionDoi,
    isExample: context.exportInput.isExample,
    created: first?.submittedAt ?? version.createdAt.toISOString(),
    updated: context.exportInput.publishedAt ?? version.createdAt.toISOString(),
    submission: {
      submittedAt: first?.submittedAt,
      submitterLogin: first?.submitterLogin,
    },
    rounds,
    publishedAt: context.exportInput.publishedAt,
  };
  return docmap(input);
}
