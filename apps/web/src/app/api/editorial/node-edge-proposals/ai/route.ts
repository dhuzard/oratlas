import { z } from "zod";
import { AiGraphCurationError, proposeGraphEdgeWithAi } from "@/lib/ai-graph-curation";
import { errorResponse } from "@/lib/api";
import { isEditor } from "@/lib/auth";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const requestSchema = z
  .object({
    sourceNodeId: z.string().trim().min(1).max(200),
    targetNodeId: z.string().trim().min(1).max(200),
    instruction: z.string().trim().max(2_000).optional(),
  })
  .strict();

export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    requestSchema,
    async (actor, body) => {
      if (!isEditor(actor)) return errorResponse("forbidden", "Editor role required.");
      try {
        return await proposeGraphEdgeWithAi({ actorId: actor.id, ...body });
      } catch (error) {
        if (error instanceof AiGraphCurationError) {
          return errorResponse(error.code, error.message);
        }
        throw error;
      }
    },
    "ai-node-edge-proposal",
  );
}
