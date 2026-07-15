import { executionPassportReverificationSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { reverifyExecutionPassport } from "@/lib/execution-passports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Re-check a stored package against the current explicit offline trust policy. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLifecyclePost(
    request,
    executionPassportReverificationSchema,
    (actor, input) => reverifyExecutionPassport(actor, id, input.expectedRevision),
    "execution-passport-verify",
  );
}
