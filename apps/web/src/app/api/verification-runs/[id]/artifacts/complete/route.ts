import { NextResponse } from "next/server";
import { completeVerificationArtifactSchema } from "@oratlas/contracts";
import { readJsonBody } from "@/lib/api";
import { authenticateVerifier, completeVerificationArtifact } from "@/lib/scientific-verification";
import { handleVerificationRouteError, validateVerifierJsonMutation } from "@/lib/verification-api";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const invalid = validateVerifierJsonMutation(request);
    if (invalid) return invalid;
    const auth = await authenticateVerifier(request, "verification:submit");
    const input = completeVerificationArtifactSchema.parse(await readJsonBody(request));
    return NextResponse.json(
      await completeVerificationArtifact((await params).id, input.artifactId, auth, request),
    );
  } catch (error) {
    return handleVerificationRouteError(error);
  }
}
