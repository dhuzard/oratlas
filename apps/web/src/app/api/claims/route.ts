import { NextResponse } from "next/server";
import { claimSearchQuerySchema } from "@oratlas/contracts";
import { InProcessSearchProvider } from "@oratlas/knowledge";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { errorResponse, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const p = new URL(request.url).searchParams;
    const parsed = claimSearchQuerySchema.safeParse({
      q: p.get("q") || undefined,
      reviewSlug: p.get("reviewSlug") || undefined,
      claimType: p.get("claimType") || undefined,
      relationType: p.get("relationType") || undefined,
      trustCriterion: p.get("trustCriterion") || undefined,
      page: p.get("page") ? Number(p.get("page")) : 1,
      pageSize: p.get("pageSize") ? Number(p.get("pageSize")) : 20,
    });
    if (!parsed.success) return errorResponse("bad-request", "Invalid claim query.");

    const index = await buildKnowledgeIndex();
    const provider = new InProcessSearchProvider(index);
    const result = provider.searchClaims(parsed.data);
    return NextResponse.json({
      total: result.total,
      items: result.items.map((c) => ({
        claimId: c.claimId,
        localClaimId: c.localClaimId,
        reviewSlug: c.reviewSlug,
        reviewVersionId: c.reviewVersionId,
        reviewTitle: c.reviewTitle,
        text: c.text,
        claimType: c.claimType,
        anchor: c.anchor,
        relations: c.relations,
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
