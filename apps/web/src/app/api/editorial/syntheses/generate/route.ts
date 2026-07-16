import { synthesisGenerationRequestSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { generateSynthesisDraft } from "@/lib/synthesis-editorial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    synthesisGenerationRequestSchema,
    (actor, body) => generateSynthesisDraft(body, { actor }),
    "synthesis-generate",
  );
}
