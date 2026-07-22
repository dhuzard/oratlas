import { nodeChallengeJson } from "@oratlas/exports";
import { errorResponse, handleRouteError } from "@/lib/api";
import { loadNodeChallengeExport } from "@/lib/node-challenge-exports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit === null ? undefined : Number(rawLimit);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      return errorResponse("bad-request", "limit must be an integer from 1 to 100.");
    }
    const input = await loadNodeChallengeExport(id, cursor, limit);
    if (!input) return errorResponse("not-found", "Knowledge node not found.");
    return new Response(nodeChallengeJson(input), {
      headers: { "Content-Type": "application/vnd.oratlas.node-challenges+json; charset=utf-8" },
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
