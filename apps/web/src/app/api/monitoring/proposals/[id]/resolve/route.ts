import { proposalResolutionSchema } from "@oratlas/contracts";
import { resolveProposal } from "@/lib/claim-monitoring";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolve an open claim-update proposal (editor role, checked in domain). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    proposalResolutionSchema,
    async (actor, body) => {
      await resolveProposal({ id: actor.id, role: actor.role }, id, body);
      return { status: body.resolution };
    },
    "monitoring",
  );
}
