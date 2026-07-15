import { protocolSnapshotInputSchema } from "@oratlas/protocols";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { registerProtocolSnapshot } from "@/lib/protocol-drift";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Register an exact OSF or ClinicalTrials.gov snapshot (editor only). */
export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    protocolSnapshotInputSchema,
    (actor, body) => registerProtocolSnapshot({ id: actor.id, role: actor.role }, body),
    "protocol-snapshot",
  );
}
