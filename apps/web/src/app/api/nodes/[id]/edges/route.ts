import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { listConfirmedEdgesForNode } from "@/lib/node-edge-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Minimal KG-07 public projection; KG-08 owns the bounded graph API. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(
      { nodeId: id, edges: await listConfirmedEdgesForNode(id) },
      { headers: { "Cache-Control": "no-store, must-revalidate" } },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
