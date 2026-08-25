import { NextResponse } from "next/server";
import { claimVerificationRunSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { authenticateVerifier, claimVerificationRun } from "@/lib/scientific-verification";
import { handleVerificationRouteError, validateVerifierJsonMutation } from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateVerifierJsonMutation(request);
    if (invalid) return invalid;
    const auth = await authenticateVerifier(request, "verification:submit");
    const input = claimVerificationRunSchema.parse(await readJsonBody(request));
    return NextResponse.json(
      await claimVerificationRun((await params).id, auth, input.leaseSeconds),
    );
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
