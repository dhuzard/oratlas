import { z } from "zod";
import { assignEditor } from "@/lib/editorial-lifecycle";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  submissionId: z.string().min(1),
  editorId: z.string().min(1),
  coi: z
    .object({ declared: z.boolean(), statement: z.string().max(2000).default("") })
    .default({ declared: false, statement: "" }),
});

/** Assign an editor to a submission (editor role required, checked in domain). */
export async function POST(request: Request) {
  return handleLifecyclePost(request, bodySchema, (actor, body) =>
    assignEditor({ id: actor.id, role: actor.role }, body.submissionId, body.editorId, body.coi),
  );
}
