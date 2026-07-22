import { z } from "zod";
import {
  decisionLetterBodySchema,
  conflictOfInterestSnapshotSchema,
  editorialOverridesSchema,
  localNodeIdSchema,
  roundDecisionSchema,
} from "@oratlas/contracts";
import { issueDecision } from "@/lib/editorial-lifecycle";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  decision: roundDecisionSchema,
  letter: decisionLetterBodySchema,
  note: z.string().max(5000).optional(),
  overrides: editorialOverridesSchema,
  selectedNodeIds: z.array(localNodeIdSchema).max(5_000).default([]),
  conflictOfInterest: conflictOfInterestSnapshotSchema,
  administratorOverride: z.boolean().default(false),
});

/** Close a round with a decision letter and apply the archive decision. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(request, bodySchema, (actor, body) =>
    issueDecision(
      { id: actor.id, role: actor.role },
      id,
      body.decision,
      body.letter,
      body.note,
      body.overrides,
      body.selectedNodeIds,
      {
        conflictOfInterest: body.conflictOfInterest,
        administratorOverride: body.administratorOverride,
      },
    ),
  );
}
