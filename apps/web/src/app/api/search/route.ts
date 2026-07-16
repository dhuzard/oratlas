import { NextResponse } from "next/server";
import { archiveSearchQuerySchema } from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { searchArchive } from "@/lib/archive-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const p = url.searchParams;
    const bool = (k: string) =>
      p.get(k) === "true" ? true : p.get(k) === "false" ? false : undefined;
    const parsed = archiveSearchQuerySchema.safeParse({
      contentType: p.get("contentType") || "all",
      nodeKind: p.get("nodeKind") || undefined,
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

    return NextResponse.json(await searchArchive(parsed.data));
  } catch (err) {
    return handleRouteError(err);
  }
}
