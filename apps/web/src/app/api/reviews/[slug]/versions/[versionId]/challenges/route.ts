import { NextResponse } from "next/server";
import { createChallengeInputSchema } from "@oratlas/contracts";
import { errorResponse, handleRouteError } from "@/lib/api";
import { createChallenge, listChallenges } from "@/lib/challenges";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
) {
  try {
    const { slug, versionId } = await params;
    const result = await listChallenges(slug, versionId);
    if (!result) return errorResponse("not-found", "Review version not found.");
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; versionId: string }> },
) {
  const { slug, versionId } = await params;
  return handleLifecyclePost(
    request,
    createChallengeInputSchema,
    async (actor, input) => {
      if (input.reviewVersionId !== versionId)
        return errorResponse("bad-request", "Route and payload review versions differ.");
      return NextResponse.json(await createChallenge(slug, actor, input), { status: 201 });
    },
    `challenge:file:${versionId}`,
  );
}
