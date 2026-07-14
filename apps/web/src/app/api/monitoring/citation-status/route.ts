import { citationStatusInputSchema } from "@oratlas/contracts";
import { registerCitationStatus } from "@/lib/claim-monitoring";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Register a cited-work status signal (editor role, checked in domain).
 * Deterministically opens one update proposal per affected claim.
 */
export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    citationStatusInputSchema,
    (actor, body) => registerCitationStatus({ id: actor.id, role: actor.role }, body),
    "monitoring",
  );
}
