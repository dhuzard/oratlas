import { NextResponse } from "next/server";
import { createChallengeInputSchema } from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { createNodeChallenge, listNodeChallenges } from "@/lib/challenges";
import { handleLifecyclePost } from "@/lib/editorial-api";

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
    const result = await listNodeChallenges(id, cursor, limit);
    if (!result) return errorResponse("not-found", "Knowledge node not found.");
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    createChallengeInputSchema,
    async (actor, input) =>
      NextResponse.json(await createNodeChallenge(id, actor, input), { status: 201 }),
    `challenge:file:node:${id}`,
  );
}
