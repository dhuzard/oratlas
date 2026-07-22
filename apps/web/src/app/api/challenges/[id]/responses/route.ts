import { createChallengeResponseInputSchema } from "@oratlas/contracts";
import { createChallengeResponse } from "@/lib/challenges";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    createChallengeResponseInputSchema,
    (actor, input) => createChallengeResponse(id, actor, input),
    `challenge:response:${id}`,
  );
}
