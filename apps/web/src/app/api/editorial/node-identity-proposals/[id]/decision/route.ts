import { nodeIdentityDecisionSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { decideNodeIdentityProposal } from "@/lib/node-identity-lifecycle";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    nodeIdentityDecisionSchema,
    (actor, body) => decideNodeIdentityProposal(actor, id, body),
    "node-identity-decision",
  );
}
