import { NextResponse } from "next/server";
import { listConfirmedEdgesForNode } from "@/lib/node-edge-lifecycle";

export const dynamic = "force-dynamic";

/** Minimal KG-07 public projection; KG-08 owns the bounded graph API. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json({ nodeId: id, edges: await listConfirmedEdgesForNode(id) });
}
