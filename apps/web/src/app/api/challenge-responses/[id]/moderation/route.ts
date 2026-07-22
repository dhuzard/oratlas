import { moderateChallengeContentInputSchema } from "@oratlas/contracts";
import { removeChallengeResponseContent } from "@/lib/challenges";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    moderateChallengeContentInputSchema,
    (actor, input) => removeChallengeResponseContent(id, actor, input),
    `challenge:response-moderate:${id}`,
  );
}
