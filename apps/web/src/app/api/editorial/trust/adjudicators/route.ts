import { z } from "zod";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { setTrustAdjudicatorDesignation } from "@/lib/trust-adjudication";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ userId: z.string().min(1).max(200), active: z.boolean() }).strict();

export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    bodySchema,
    (actor, body) => setTrustAdjudicatorDesignation(actor, body.userId, body.active),
    "trust-adjudicator-designation",
  );
}
