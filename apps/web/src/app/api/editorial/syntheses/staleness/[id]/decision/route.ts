import { synthesisRegenerationProposalDecisionSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { decideSynthesisRegenerationProposal } from "@/lib/synthesis-staleness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleLifecyclePost(
    request,
    synthesisRegenerationProposalDecisionSchema,
    (actor, body) => decideSynthesisRegenerationProposal(actor, id, body),
    "synthesis-staleness-decision",
  );
}
