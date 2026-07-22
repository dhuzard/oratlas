import {
  conflictOfInterestSnapshotSchema,
  editorialOverridesSchema,
  localNodeIdSchema,
} from "@oratlas/contracts";
import { z } from "zod";
import { AuthError, isEditor } from "@/lib/auth";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { acceptSubmission, decideSubmission } from "@/lib/submissions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z
  .object({
    submissionId: z.string().min(1),
    decision: z.enum(["accept", "reject", "request-changes"]),
    note: z.string().max(5_000).optional(),
    overrides: editorialOverridesSchema,
    selectedNodeIds: z.array(localNodeIdSchema).max(5_000).default([]),
    conflictOfInterest: conflictOfInterestSnapshotSchema,
    administratorOverride: z.boolean().default(false),
  })
  .strict();

/** Editorial decision endpoint with shared auth, origin, rate and body-size enforcement. */
export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    bodySchema,
    async (actor, body) => {
      if (!isEditor(actor)) throw new AuthError("Editor role required.", 403);
      if (body.decision === "accept") {
        const result = await acceptSubmission(
          body.submissionId,
          actor.id,
          body.note,
          body.overrides,
          body.selectedNodeIds,
          undefined,
          undefined,
          {
            conflictOfInterest: body.conflictOfInterest,
            administratorOverride: body.administratorOverride,
          },
        );
        return { status: "accepted", ...result };
      }
      const result = await decideSubmission(
        body.submissionId,
        actor.id,
        body.decision,
        body.note,
        undefined,
        undefined,
        {
          conflictOfInterest: body.conflictOfInterest,
          administratorOverride: body.administratorOverride,
        },
      );
      return { status: body.decision, idempotent: result.idempotent };
    },
    "editorial-decision",
  );
}
