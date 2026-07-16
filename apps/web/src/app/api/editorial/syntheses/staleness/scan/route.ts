import { synthesisStalenessScanRequestSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { scanAcceptedSyntheses } from "@/lib/synthesis-staleness";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    synthesisStalenessScanRequestSchema,
    (actor) => scanAcceptedSyntheses({ actor }),
    "synthesis-staleness-scan",
  );
}
