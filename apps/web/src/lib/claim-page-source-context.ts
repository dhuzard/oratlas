import "server-only";
import {
  claimScopeSchema,
  publicationHttpsUrlSchema,
  publicationClaimSourceBindingSchema,
} from "@oratlas/contracts";
import { prisma, parseJsonColumn } from "./db";

/** Page-only context; keep the existing machine-readable passport contract unchanged. */
export async function getClaimPageSourceContext(versionId: string, localClaimId: string) {
  const claim = await prisma.claim.findFirst({
    where: {
      reviewVersionId: versionId,
      localClaimId,
      reviewVersion: {
        publicState: { in: ["published", "withdrawn"] },
        review: { status: "published" },
      },
    },
    select: {
      section: true,
      anchor: true,
      scopeJson: true,
      reviewVersion: {
        select: {
          id: true,
          publicState: true,
          snapshot: { select: { commitSha: true } },
          review: { select: { slug: true, repository: { select: { canonicalUrl: true } } } },
        },
      },
    },
  });
  if (!claim) return null;
  const version = claim.reviewVersion;
  const sourceUrl = publicationHttpsUrlSchema.safeParse(version.review.repository?.canonicalUrl);
  const scope = claimScopeSchema.safeParse(parseJsonColumn<unknown>(claim.scopeJson, null));
  return {
    versionId: version.id,
    preservedHref: `/reviews/${encodeURIComponent(version.review.slug)}/versions/${encodeURIComponent(version.id)}`,
    originalUrl: sourceUrl.success ? sourceUrl.data : undefined,
    locator: [claim.section, claim.anchor].filter(Boolean).join(" · ") || undefined,
    lifecycle: version.publicState,
    commitSha: version.snapshot?.commitSha,
    scope: scope.success ? scope.data : null,
  };
}

/** Exact external graph binding only; no search or fallback to another occurrence/version. */
export async function getExternalOccurrencePageContext(input: {
  nodeId: string;
  nodeVersionId: string;
  occurrenceId: string;
  publicationVersionId: string;
}) {
  const occurrence = await prisma.publicationClaimOccurrence.findFirst({
    where: {
      id: input.occurrenceId,
      publicationVersionId: input.publicationVersionId,
      knowledgeNodeId: input.nodeId,
      graphVersion: { id: input.nodeVersionId, knowledgeNodeId: input.nodeId },
      publicationVersion: { publication: { recordSource: "external-publication" } },
    },
    select: { sourceBindingJson: true },
  });
  if (!occurrence) return null;
  const binding = publicationClaimSourceBindingSchema.safeParse(
    parseJsonColumn<unknown>(occurrence.sourceBindingJson, null),
  );
  return {
    locator: binding.success
      ? `${binding.data.documentPath}:L${binding.data.startLine}-L${binding.data.endLine}`
      : undefined,
  };
}
