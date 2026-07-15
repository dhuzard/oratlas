import { NextResponse } from "next/server";
import {
  replicationBriefCreateSchema,
  replicationMarketplaceQuerySchema,
} from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { handleLifecyclePost } from "@/lib/editorial-api";
import {
  createReplicationBriefDraft,
  listPublicReplicationBriefs,
} from "@/lib/replication-marketplace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const parsed = replicationMarketplaceQuerySchema.safeParse({
      status: params.get("status") || undefined,
      effortBand: params.get("effortBand") || undefined,
      page: params.has("page") ? Number(params.get("page")) : undefined,
      pageSize: params.has("pageSize") ? Number(params.get("pageSize")) : undefined,
    });
    if (!parsed.success) return errorResponse("bad-request", "Invalid marketplace query.");
    const result = await listPublicReplicationBriefs(parsed.data);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store, must-revalidate" } });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** Create an editor-authored draft. This endpoint never publishes automatically. */
export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    replicationBriefCreateSchema,
    (actor, body) => createReplicationBriefDraft({ id: actor.id, role: actor.role }, body),
    "replications:create",
  );
}
