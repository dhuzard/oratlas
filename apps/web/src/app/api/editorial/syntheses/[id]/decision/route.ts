import { synthesisDraftDecisionSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { decideSynthesisDraft } from "@/lib/synthesis-editorial";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    synthesisDraftDecisionSchema,
    (actor, body) => decideSynthesisDraft(id, body, actor),
    "synthesis-decision",
  );
}
