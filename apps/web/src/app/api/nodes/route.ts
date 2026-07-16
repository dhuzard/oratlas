import { NextResponse } from "next/server";
import { nodeArchiveQuerySchema } from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { listPublicNodes } from "@/lib/node-publication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const query = nodeArchiveQuerySchema.safeParse({
      q: params.get("q") || undefined,
      kind: params.get("kind") || undefined,
      page: params.get("page") ? Number(params.get("page")) : 1,
      pageSize: params.get("pageSize") ? Number(params.get("pageSize")) : 20,
    });
    if (!query.success) return errorResponse("bad-request", "Invalid node archive query.");
    return NextResponse.json(await listPublicNodes(query.data), {
      headers: { "Cache-Control": "no-store, must-revalidate" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
