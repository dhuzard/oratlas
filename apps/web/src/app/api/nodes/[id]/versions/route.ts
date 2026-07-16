import { NextResponse } from "next/server";
import { publicNodeVersionListResponseSchema } from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { getPublicNode } from "@/lib/node-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const node = await getPublicNode(id);
    if (!node) return errorResponse("not-found", "Knowledge node not found.");
    return NextResponse.json(
      publicNodeVersionListResponseSchema.parse({
        nodeId: node.id,
        currentVersionId: node.versions.find((version) => version.isCurrent)!.id,
        items: node.versions,
      }),
      { headers: { "Cache-Control": "no-store, must-revalidate" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
