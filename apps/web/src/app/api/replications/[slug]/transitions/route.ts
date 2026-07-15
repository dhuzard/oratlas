import { replicationBriefTransitionSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { transitionReplicationBrief } from "@/lib/replication-marketplace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Guarded CAS lifecycle transition; authorization is action-specific and fail closed. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return handleLifecyclePost(
    request,
    replicationBriefTransitionSchema,
    (actor, body) => transitionReplicationBrief({ id: actor.id, role: actor.role }, slug, body),
    "replications:transition",
  );
}
