import { NextResponse } from "next/server";
import {
  publicationClaimSelectorSchema,
  publicationClaimSourceBindingSchema,
  publicationClaimTargetSchema,
} from "@oratlas/contracts";
import { errorResponse } from "@/lib/api";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function parse(value: string): unknown {
  return JSON.parse(value) as unknown;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const occurrence = await prisma.publicationClaimOccurrence.findUnique({
    where: { id },
    include: { graphVersion: { select: { id: true } } },
  });
  if (!occurrence) return errorResponse("not-found", "Publication claim occurrence not found.");
  return NextResponse.json({
    schemaVersion: "1.0.0",
    id: occurrence.id,
    publicationVersionId: occurrence.publicationVersionId,
    publicationVersionHref: `/api/publication-versions/${occurrence.publicationVersionId}`,
    sourceLocalClaimId: occurrence.sourceLocalClaimId,
    target: publicationClaimTargetSchema.parse(parse(occurrence.targetJson)),
    publishedTargetUrl: occurrence.publishedUrl,
    sourceBinding: publicationClaimSourceBindingSchema.parse(parse(occurrence.sourceBindingJson)),
    selector: publicationClaimSelectorSchema.parse(parse(occurrence.selectorJson)),
    declarationSha256: occurrence.declarationSha256,
    declarationAuthority: occurrence.declarationAuthority,
    text: occurrence.text,
    claimType: occurrence.claimType,
    qualification: occurrence.qualification,
    canonicalBinding:
      occurrence.knowledgeNodeId && occurrence.graphVersion
        ? {
            knowledgeNodeId: occurrence.knowledgeNodeId,
            knowledgeNodeVersionId: occurrence.graphVersion.id,
            graphHref: `/api/graph?seed=${encodeURIComponent(occurrence.knowledgeNodeId)}&version=${encodeURIComponent(occurrence.graphVersion.id)}`,
          }
        : null,
  });
}
