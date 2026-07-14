import { z } from "zod";
import { orcidSchema } from "@oratlas/contracts";
import { setUserOrcid } from "@/lib/editorial-lifecycle";
import { handleLifecyclePost } from "@/lib/editorial-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({ orcid: orcidSchema.nullable() });

/**
 * Attach or clear the signed-in user's ORCID iD. Always stored unverified;
 * verification requires an ORCID sign-in flow that the POC does not ship.
 */
export async function POST(request: Request) {
  return handleLifecyclePost(request, bodySchema, async (actor, body) => {
    await setUserOrcid({ id: actor.id, role: actor.role }, body.orcid);
    return { orcid: body.orcid, verified: false };
  });
}
