import { z } from "zod";
import { openReviewRound } from "@/lib/editorial-lifecycle";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ submissionId: z.string().min(1) });

/** Open the next formal review round (actively assigned editor only). */
export async function POST(request: Request) {
  return handleLifecyclePost(request, bodySchema, (actor, body) =>
    openReviewRound({ id: actor.id, role: actor.role }, body.submissionId),
  );
}
