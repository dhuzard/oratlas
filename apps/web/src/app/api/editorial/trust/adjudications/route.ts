import { createTrustAdjudicationInputSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { createTrustAdjudication } from "@/lib/trust-adjudication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    createTrustAdjudicationInputSchema,
    (actor, body) => createTrustAdjudication(actor, body),
    "trust-adjudication",
  );
}
