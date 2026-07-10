import { NextResponse } from "next/server";
import { archiveSearchQuerySchema } from "@oratlas/contracts";
import { InProcessSearchProvider } from "@oratlas/knowledge";
import { buildKnowledgeIndex } from "@/lib/index-builder";
import { errorResponse, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const p = url.searchParams;
    const bool = (k: string) =>
      p.get(k) === "true" ? true : p.get(k) === "false" ? false : undefined;
    const parsed = archiveSearchQuerySchema.safeParse({
      q: p.get("q") || undefined,
      domain: p.get("domain") || undefined,
      author: p.get("author") || undefined,
      hasDoi: bool("hasDoi"),
      hasTrustData: bool("hasTrustData"),
      hasEvidenceData: bool("hasEvidenceData"),
      compatibility: p.get("compatibility") || undefined,
      trustReviewState: p.get("trustReviewState") || undefined,
      sort: p.get("sort") || "accepted",
      page: p.get("page") ? Number(p.get("page")) : 1,
      pageSize: p.get("pageSize") ? Number(p.get("pageSize")) : 20,
    });
    if (!parsed.success) return errorResponse("bad-request", "Invalid search query.");

    const index = await buildKnowledgeIndex();
    const provider = new InProcessSearchProvider(index);
    const result = provider.searchReviews(parsed.data);
    return NextResponse.json({
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      items: result.items.map((r) => ({
        slug: r.reviewSlug,
        title: r.title,
        authors: r.authors,
        domains: r.domains,
        hasDoi: r.hasDoi,
        hasTrustData: r.hasTrustData,
        compatibilityLevel: r.compatibilityLevel,
        score: r.score,
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
