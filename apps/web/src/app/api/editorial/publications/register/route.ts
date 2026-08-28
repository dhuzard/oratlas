import { publicationRegistrationRequestSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { requireEditor } from "@/lib/auth";
import { registerExternalPublication } from "@/lib/publication-registration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Register an externally hosted publication by its manifest URL.
 *
 * Editor-only. Registration retrieves an attacker-controlled URL, so it is an
 * editorial action attributed to the editor who performed it — **not** a proof
 * that they own the publication. Ownership of an arbitrary publication URL is
 * an unsolved governance problem, deliberately not approximated here; see
 * `docs/external-publications.md`.
 *
 * The response states the structural provenance level actually reached and,
 * when source bytes were not obtained, exactly why.
 */
export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    publicationRegistrationRequestSchema,
    async (actor, input) => {
      await requireEditor();
      return registerExternalPublication({
        manifestUrl: input.manifestUrl,
        ...(input.publicationType === undefined ? {} : { publicationType: input.publicationType }),
        actorId: actor.id,
      });
    },
    "publication-register",
  );
}
