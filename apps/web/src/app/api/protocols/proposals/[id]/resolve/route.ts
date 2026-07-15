import { protocolProposalResolutionSchema } from "@oratlas/protocols";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { resolveProtocolProposal } from "@/lib/protocol-drift";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolve one open protocol-drift proposal with an attributable note. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    protocolProposalResolutionSchema,
    async (actor, body) => {
      await resolveProtocolProposal({ id: actor.id, role: actor.role }, id, body);
      return { status: body.resolution };
    },
    "protocol-proposal",
  );
}
