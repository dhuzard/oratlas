import { NextResponse } from "next/server";
import { getReviewDetail } from "@/lib/reviews";
import { errorResponse, handleRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const review = await getReviewDetail(slug);
    if (!review) return errorResponse("not-found", "Review not found.");
    return NextResponse.json(review);
  } catch (err) {
    return handleRouteError(err);
  }
}
