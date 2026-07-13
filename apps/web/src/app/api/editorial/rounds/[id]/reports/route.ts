import { z } from "zod";
import { formalReviewReportBodySchema, reviewRecommendationSchema } from "@oratlas/contracts";
import { submitReviewReport } from "@/lib/editorial-lifecycle";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  recommendation: reviewRecommendationSchema,
  body: formalReviewReportBodySchema,
  coiStatement: z.string().max(2000).optional(),
});

/** Submit an immutable formal review report (any signed-in non-conflicted user). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(request, bodySchema, (actor, body) =>
    submitReviewReport(
      { id: actor.id, role: actor.role },
      id,
      body.recommendation,
      body.body,
      body.coiStatement,
    ),
  );
}
