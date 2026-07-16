import { nodeEdgeDecisionSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { decideNodeEdgeProposal } from "@/lib/node-edge-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    nodeEdgeDecisionSchema,
    (actor, body) => decideNodeEdgeProposal(actor, id, body),
    "node-edge-decision",
  );
}
