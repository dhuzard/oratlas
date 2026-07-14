import { z } from "zod";
import { recuseEditor } from "@/lib/editorial-lifecycle";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ statement: z.string().min(10).max(2000) });

/** Recuse an assignment (the assigned editor themselves, or an admin). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(request, bodySchema, async (actor, body) => {
    await recuseEditor({ id: actor.id, role: actor.role }, id, body.statement);
    return { status: "recused" };
  });
}
