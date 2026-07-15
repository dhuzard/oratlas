import { federationResolutionSchema } from "@oratlas/federation";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { resolveFederationNotification } from "@/lib/federation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    federationResolutionSchema,
    (actor, body) => resolveFederationNotification(actor, id, body),
    "federation-resolve",
  );
}
