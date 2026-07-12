import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getReviewVersionDiff } from "@/lib/version-diff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const query = new URL(request.url).searchParams;
    const from = query.get("from");
    const to = query.get("to");
    if (!from || !to || from.length > 200 || to.length > 200) {
      return errorResponse("bad-request", "Both from and to version ids are required.");
    }
    const diff = await getReviewVersionDiff(slug, from, to);
    if (!diff) return errorResponse("not-found", "Comparable review versions not found.");
    return NextResponse.json(diff, {
      headers: {
        "Cache-Control": "no-store, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
