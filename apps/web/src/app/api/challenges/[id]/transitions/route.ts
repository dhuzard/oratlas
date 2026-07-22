import { transitionChallengeInputSchema } from "@oratlas/contracts";
import { transitionChallenge } from "@/lib/challenges";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    transitionChallengeInputSchema,
    (actor, input) => transitionChallenge(id, actor, input),
    `challenge:transition:${id}`,
  );
}
