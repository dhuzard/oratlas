import { z } from "zod";
import { authorResponseBodySchema } from "@oratlas/contracts";
import { submitAuthorResponse } from "@/lib/editorial-lifecycle";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ body: authorResponseBodySchema });

/** Submit an author response within an open round (submitter only). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(request, bodySchema, (actor, body) =>
    submitAuthorResponse({ id: actor.id, role: actor.role }, id, body.body),
  );
}
