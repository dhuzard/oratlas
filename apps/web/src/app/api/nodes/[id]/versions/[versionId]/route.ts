import { NextResponse } from "next/server";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPublicNode } from "@/lib/node-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const { id, versionId } = await params;
    const node = await getPublicNode(id, versionId);
    if (!node) return errorResponse("not-found", "Knowledge node version not found.");
    return NextResponse.json(node, {
      headers: { "Cache-Control": "public, max-age=0, must-revalidate" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
