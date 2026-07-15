import { executionPassportRegistrationSchema } from "@oratlas/contracts";
import { handleLifecyclePost } from "@/lib/editorial-api";
import { registerExecutionPassport } from "@/lib/execution-passports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Editor-only registration; verification is offline and precedes every write. */
export async function POST(request: Request) {
  return handleLifecyclePost(
    request,
    executionPassportRegistrationSchema,
    (actor, input) => registerExecutionPassport(actor, input),
    "execution-passport-register",
  );
}
