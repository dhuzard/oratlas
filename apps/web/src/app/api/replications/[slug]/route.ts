import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPublicReplicationBrief } from "@/lib/replication-marketplace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const brief = await getPublicReplicationBrief(slug);
    if (!brief) return errorResponse("not-found", "Replication brief not found.");
    return NextResponse.json(brief, { headers: { "Cache-Control": "no-store, must-revalidate" } });
  } catch (error) {
    return handleRouteError(error);
  }
}
